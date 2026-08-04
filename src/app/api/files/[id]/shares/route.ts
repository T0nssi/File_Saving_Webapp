import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import UserModel from "@/models/User";
import { requireUser } from "@/lib/session";
import { canView, ensureFileOwnersBackfilled, isOwnerOrAdmin } from "@/lib/filePermissions";
import { isValidObjectId } from "@/lib/validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await dbConnect();
  await ensureFileOwnersBackfilled();
  const file = await FileModel.findById(id).lean();
  if (!file || !canView(file, requester)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only the owner/admin manages sharing, but showing the list to anyone with
  // view access would leak who else can see a file they don't control — keep
  // this endpoint owner/admin-only too, distinct from just viewing the file.
  if (!isOwnerOrAdmin(file, requester)) {
    return NextResponse.json({ error: "Only the owner or an admin can view sharing for this file" }, { status: 403 });
  }

  const userIds = file.sharedWith.map((s) => s.userId);
  const users = userIds.length > 0
    ? await UserModel.find({ _id: { $in: userIds } }).select("_id username").lean()
    : [];
  const usernameById = new Map(users.map((u) => [u._id.toString(), u.username]));

  const shares = file.sharedWith.map((s) => ({
    userId: s.userId.toString(),
    username: usernameById.get(s.userId.toString()) ?? "(deleted user)",
    permission: s.permission,
    sharedAt: s.sharedAt,
  }));

  return NextResponse.json({ shares });
}

export async function POST(req: NextRequest, { params }: Params) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const permission = body.permission;
    if (!username) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }
    if (permission !== "view" && permission !== "edit") {
      return NextResponse.json({ error: "Permission must be \"view\" or \"edit\"" }, { status: 400 });
    }

    await dbConnect();
    await ensureFileOwnersBackfilled();
    const file = await FileModel.findById(id);
    if (!file || !canView(file, requester)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isOwnerOrAdmin(file, requester)) {
      return NextResponse.json({ error: "Only the owner or an admin can share this file" }, { status: 403 });
    }

    const targetUser = await UserModel.findOne({ username }).select("_id username").lean();
    if (!targetUser) {
      return NextResponse.json({ error: `No user named "${username}"` }, { status: 404 });
    }
    if (targetUser._id.toString() === (file.ownerId?.toString() ?? "")) {
      return NextResponse.json({ error: "That user already owns this file" }, { status: 400 });
    }

    const existing = file.sharedWith.find((s) => s.userId.toString() === targetUser._id.toString());
    if (existing) {
      existing.permission = permission;
      existing.sharedAt = new Date();
    } else {
      file.sharedWith.push({ userId: targetUser._id, permission, sharedAt: new Date() });
    }
    await file.save();

    return NextResponse.json({
      success: true,
      share: { userId: targetUser._id.toString(), username: targetUser.username, permission },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown share error";
    console.error("Share error:", message);
    return NextResponse.json({ error: "Failed to share file" }, { status: 500 });
  }
}
