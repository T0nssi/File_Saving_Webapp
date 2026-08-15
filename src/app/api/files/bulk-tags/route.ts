import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { requireUser } from "@/lib/session";
import { canEdit, ensureFileOwnersBackfilled } from "@/lib/filePermissions";
import { isValidObjectId, parseTags } from "@/lib/validation";

const MAX_BULK_FILES = 200;

// Adds and/or removes tags across many files in one request — the search
// page's "edit tags" bulk action. Each file is still checked individually
// for edit access; files the requester can't edit are silently skipped
// (not an error) rather than failing the whole batch, since a mixed
// selection of own/shared files is the normal case, not an edge case.
export async function POST(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.fileIds)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const fileIds: string[] = body.fileIds.filter((id: unknown): id is string => typeof id === "string" && isValidObjectId(id));
  if (fileIds.length === 0) {
    return NextResponse.json({ error: "No valid file ids provided" }, { status: 400 });
  }
  if (fileIds.length > MAX_BULK_FILES) {
    return NextResponse.json({ error: `Too many files (max ${MAX_BULK_FILES} at once)` }, { status: 400 });
  }

  const addTags = parseTags(body.addTags ?? "");
  const removeTags = new Set(parseTags(body.removeTags ?? ""));
  if (addTags.length === 0 && removeTags.size === 0) {
    return NextResponse.json({ error: "Nothing to add or remove" }, { status: 400 });
  }

  await dbConnect();
  await ensureFileOwnersBackfilled();

  const files = await FileModel.find({ _id: { $in: fileIds } });

  let updated = 0;
  const skipped: string[] = [];
  const ops = [];
  for (const file of files) {
    if (!canEdit(file, requester)) {
      skipped.push(file.filename);
      continue;
    }
    const merged = new Set(file.tags);
    addTags.forEach((t) => merged.add(t));
    removeTags.forEach((t) => merged.delete(t));
    const nextTags = parseTags([...merged]);
    ops.push({
      updateOne: {
        filter: { _id: file._id },
        update: { $set: { tags: nextTags } },
      },
    });
    updated += 1;
  }

  // Files present in fileIds but not found at all (deleted, or a bad id
  // that still passed isValidObjectId) are silently absent from `files` —
  // they don't need a separate skip reason, the count already reflects it.
  const notFound = fileIds.length - files.length;

  if (ops.length > 0) {
    await FileModel.bulkWrite(ops);
    await logEvent({
      level: "info",
      action: "update",
      message: `Bulk tag edit by ${requester.username}: ${updated} file(s)${addTags.length ? `, added [${addTags.join(", ")}]` : ""}${removeTags.size ? `, removed [${[...removeTags].join(", ")}]` : ""}`,
    });
  }

  return NextResponse.json({
    updated,
    skipped: skipped.length + notFound,
  });
}
