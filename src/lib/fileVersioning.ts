import type mongoose from "mongoose";
import FileModel, { IFile } from "@/models/File";
import RevisionModel from "@/models/Revision";
import { canEdit } from "@/lib/filePermissions";
import { claimNextVersion } from "@/lib/revisionVersion";
import type { CurrentUser } from "@/lib/session";

export interface NewContent {
  gridFsId: mongoose.Types.ObjectId;
  size: number;
  mimeType: string;
}

export type ApplyVersionResult =
  | { ok: true; file: mongoose.HydratedDocument<IFile> }
  | { ok: false; reason: string };

// Points a file's content at `content`, preserving what it used to hold as a
// permanent Revision — the same git-style history pattern used by the Excel
// editor's save and the image "Replace" action, generalized so any caller
// (those two, plus the duplicate-name-on-upload flow) can reuse one
// implementation instead of drifting apart. The target file is re-fetched
// and re-checked here rather than trusted from the caller, since a caller's
// target id may come from a client request made moments (or a permission
// change) earlier.
export async function applyAsNewVersion(
  targetFileId: string,
  content: NewContent,
  requester: CurrentUser,
  changesSummary: string
): Promise<ApplyVersionResult> {
  const file = await FileModel.findById(targetFileId);
  if (!file) return { ok: false, reason: "the file being versioned no longer exists" };
  if (!canEdit(file, requester)) return { ok: false, reason: "no edit access to the file being versioned" };

  const oldGridFsId = file.gridFsId;
  const oldSize = file.size;
  const nextVersion = await claimNextVersion(targetFileId);

  const revision = new RevisionModel({
    fileId: targetFileId,
    versionNumber: nextVersion,
    gridFsId: oldGridFsId,
    changedBy: requester.username,
    changesSummary,
    size: oldSize,
  });
  await revision.save();

  file.gridFsId = content.gridFsId;
  file.size = content.size;
  file.mimeType = content.mimeType;
  file.currentVersion = nextVersion;
  await file.save();

  // Note: oldGridFsId is NOT deleted — the revision just created above now
  // owns that blob as its permanent snapshot.
  return { ok: true, file };
}
