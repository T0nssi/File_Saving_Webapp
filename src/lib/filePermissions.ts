import mongoose from "mongoose";
import FileModel, { IFile, SharePermission } from "@/models/File";
import UserModel from "@/models/User";
import type { CurrentUser } from "@/lib/session";
import type { FilterQuery, Types } from "mongoose";

// Minimal shape access checks need — works for both hydrated Mongoose
// documents and .lean() plain objects, whichever a given route already has.
export interface FileAccessInput {
  ownerId: Types.ObjectId | string | null;
  sharedWith: { userId: Types.ObjectId | string; permission: SharePermission }[];
}

// Admins always get full access. Otherwise: owner gets edit; an explicit
// share grants exactly the permission it was given; anyone else gets none.
// A file with no owner (not yet backfilled, or its uploader account is gone)
// grants no access to non-admins — private-by-default extends to "we don't
// know whose it is" too, rather than defaulting that case open.
export function getFileAccess(file: FileAccessInput, requester: CurrentUser): SharePermission | null {
  if (requester.role === "admin") return "edit";

  const ownerId = file.ownerId?.toString();
  if (ownerId && ownerId === requester.id) return "edit";

  const share = file.sharedWith.find((s) => s.userId.toString() === requester.id);
  return share?.permission ?? null;
}

export function canView(file: FileAccessInput, requester: CurrentUser): boolean {
  return getFileAccess(file, requester) !== null;
}

export function canEdit(file: FileAccessInput, requester: CurrentUser): boolean {
  return getFileAccess(file, requester) === "edit";
}

// Stricter than canEdit: excludes users who only have a shared "edit" grant.
// Reserved for actions that go beyond editing content — deleting the file
// outright, and managing who else it's shared with.
export function isOwnerOrAdmin(file: FileAccessInput, requester: CurrentUser): boolean {
  if (requester.role === "admin") return true;
  return file.ownerId?.toString() === requester.id;
}

// Mongo filter clause restricting a File query to what `requester` may view.
// Admins get {} (no restriction, i.e. everything). Uses a real ObjectId
// rather than the raw id string: .find() auto-casts either way, but
// .aggregate()'s $match does not, so this needs to work for both callers.
export function accessFilter(requester: CurrentUser): FilterQuery<IFile> {
  if (requester.role === "admin") return {};
  const uid = new mongoose.Types.ObjectId(requester.id);
  return {
    $or: [{ ownerId: uid }, { "sharedWith.userId": uid }],
  };
}

let backfillDone = false;

// Lazily assigns ownerId to any file that predates this field, by matching
// its uploadedBy username against the User collection. Idempotent and cheap
// after the first successful run per process (only ever queries ownerId:null
// docs). Files whose uploader no longer exists, or was never recorded, stay
// ownerless — private-by-default falls back to admin-only for those rather
// than guessing.
export async function ensureFileOwnersBackfilled(): Promise<void> {
  if (backfillDone) return;

  const orphans = await FileModel.find({ ownerId: null }).select("_id uploadedBy").lean();
  if (orphans.length === 0) {
    backfillDone = true;
    return;
  }

  const usernames = [...new Set(orphans.map((f) => f.uploadedBy).filter(Boolean))];
  const users = usernames.length > 0
    ? await UserModel.find({ username: { $in: usernames } }).select("_id username").lean()
    : [];
  const usernameToId = new Map(users.map((u) => [u.username, u._id]));

  const ops = orphans
    .map((f) => {
      const ownerId = usernameToId.get(f.uploadedBy);
      return ownerId ? { updateOne: { filter: { _id: f._id }, update: { $set: { ownerId } } } } : null;
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  if (ops.length > 0) await FileModel.bulkWrite(ops);
  backfillDone = true;
}
