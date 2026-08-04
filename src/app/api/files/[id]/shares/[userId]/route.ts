import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { canView, ensureFileOwnersBackfilled, isOwnerOrAdmin } from "@/lib/filePermissions";
import { isValidObjectId } from "@/lib/validation";

interface Params {
  params: Promise<{ id: string; userId: string }>;
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, userId } = await params;
  if (!isValidObjectId(id) || !isValidObjectId(userId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await dbConnect();
  await ensureFileOwnersBackfilled();
  const file = await FileModel.findById(id);
  if (!file || !canView(file, requester)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isOwnerOrAdmin(file, requester)) {
    return NextResponse.json({ error: "Only the owner or an admin can change sharing on this file" }, { status: 403 });
  }

  const before = file.sharedWith.length;
  file.sharedWith = file.sharedWith.filter((s) => s.userId.toString() !== userId);
  if (file.sharedWith.length === before) {
    return NextResponse.json({ error: "That share doesn't exist" }, { status: 404 });
  }
  await file.save();

  return NextResponse.json({ success: true });
}
