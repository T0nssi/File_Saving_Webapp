import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FolderModel from "@/models/Folder";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { isValidObjectId, sanitizeFolderName } from "@/lib/validation";
import { requireUser } from "@/lib/session";
import { deleteFileCompletely } from "@/lib/fileDeletion";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await dbConnect();
    const folder = await FolderModel.findById(id);
    if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    if (typeof body.name === "string" && body.name.trim()) {
      const before = folder.name;
      folder.name = sanitizeFolderName(body.name);
      await folder.save();
      await logEvent({
        level: "info",
        action: "system",
        message: `Renamed folder "${before}" to "${folder.name}"`,
      });
    }

    // Drag-and-drop reparenting. body.parentId: null/"root" = move to top
    // level, an id = move under that folder.
    if (body.parentId !== undefined) {
      let newParentId: string | null = null;
      if (body.parentId !== null && body.parentId !== "root") {
        if (!isValidObjectId(body.parentId)) {
          return NextResponse.json({ error: "Invalid parent folder" }, { status: 400 });
        }
        newParentId = body.parentId;
      }

      if (newParentId === id) {
        return NextResponse.json({ error: "A folder can't be moved into itself" }, { status: 400 });
      }

      if (newParentId) {
        const target = await FolderModel.findById(newParentId).select("_id").lean();
        if (!target) {
          return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
        }

        // Walk up from the target parent — if this folder's own id shows up
        // anywhere in that chain, the move would nest it inside its own
        // descendant, which would disconnect it from the tree entirely.
        let cursor: string | null = newParentId;
        const seen = new Set<string>();
        while (cursor) {
          if (cursor === id) {
            return NextResponse.json(
              { error: "Can't move a folder into one of its own subfolders" },
              { status: 400 }
            );
          }
          if (seen.has(cursor)) break; // defensive guard against corrupt/cyclic data
          seen.add(cursor);
          const ancestor: { parentId: unknown } | null = await FolderModel.findById(cursor)
            .select("parentId")
            .lean();
          cursor = ancestor?.parentId ? String(ancestor.parentId) : null;
        }
      }

      const before = folder.parentId ? folder.parentId.toString() : null;
      if (before !== newParentId) {
        folder.parentId = newParentId as unknown as typeof folder.parentId;
        await folder.save();
        await logEvent({
          level: "info",
          action: "system",
          message: `Moved folder "${folder.name}"`,
          meta: { from: before, to: newParentId },
        });
      }
    }

    return NextResponse.json({ folder });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown folder error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const requester = await requireUser(_req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The folder tree is a shared namespace anyone can create/rename in, but
  // deleting one reparents *every* file inside it in one shot — including
  // files the requester may not own, have been shared, or can even see.
  // Without this, a member could relocate someone else's private file just
  // by deleting the folder it happens to sit in. Restricted to admins.
  if (requester.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can delete a folder" }, { status: 403 });
  }

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const mode = new URL(_req.url).searchParams.get("mode") === "deleteAll" ? "deleteAll" : "moveUp";

  try {
    await dbConnect();
    const folder = await FolderModel.findById(id);
    if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (mode === "moveUp") {
      // Never delete file data by deleting a folder: any direct child folders
      // and files are moved up to this folder's parent, then the now-empty
      // folder itself is removed. Worst case a file lands back in "ยังไม่จัดหมวด".
      await FolderModel.updateMany({ parentId: folder._id }, { parentId: folder.parentId });
      await FileModel.updateMany({ folderId: folder._id }, { folderId: folder.parentId });
      await folder.deleteOne();

      await logEvent({
        level: "info",
        action: "system",
        message: `Deleted folder "${folder.name}" (contents moved up one level)`,
      });

      return NextResponse.json({ success: true, mode });
    }

    // deleteAll: find every descendant folder (including this one), then
    // every file inside any of them, and permanently remove all of it —
    // GridFS blobs, revisions, the files, then the folders themselves.
    const descendants = await FolderModel.aggregate([
      { $match: { _id: folder._id } },
      {
        $graphLookup: {
          from: "folders",
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "parentId",
          as: "descendants",
        },
      },
      { $project: { allIds: { $concatArrays: [["$_id"], "$descendants._id"] } } },
    ]);
    const allFolderIds: unknown[] = descendants[0]?.allIds ?? [folder._id];

    const filesToDelete = await FileModel.find({ folderId: { $in: allFolderIds } })
      .select("_id gridFsId")
      .lean();

    const bucket = await getBucket();
    for (const f of filesToDelete) {
      await deleteFileCompletely(f._id.toString(), f.gridFsId, bucket);
    }

    await FolderModel.deleteMany({ _id: { $in: allFolderIds } });

    await logEvent({
      level: "warn",
      action: "delete",
      message: `Deleted folder "${folder.name}" and everything inside it (${filesToDelete.length} file(s), ${allFolderIds.length - 1} subfolder(s))`,
      meta: { by: requester.username, fileCount: filesToDelete.length, folderCount: allFolderIds.length - 1 },
    });

    return NextResponse.json({ success: true, mode, deletedFiles: filesToDelete.length, deletedFolders: allFolderIds.length - 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown folder error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
