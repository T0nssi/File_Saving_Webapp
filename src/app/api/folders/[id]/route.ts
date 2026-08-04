import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FolderModel from "@/models/Folder";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { isValidObjectId, sanitizeFolderName } from "@/lib/validation";
import { requireUser } from "@/lib/session";

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

  try {
    await dbConnect();
    const folder = await FolderModel.findById(id);
    if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown folder error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
