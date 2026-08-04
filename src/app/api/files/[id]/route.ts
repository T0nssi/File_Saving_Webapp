import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";
import { logEvent } from "@/lib/logger";
import { requireUser } from "@/lib/session";
import { canEdit, canView, ensureFileOwnersBackfilled, getFileAccess, isOwnerOrAdmin } from "@/lib/filePermissions";
import {
  isValidObjectId,
  parseTags,
  sanitizeDescription,
  sanitizeFilename,
} from "@/lib/validation";

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
  const doc = await FileModel.findById(id).lean();
  if (!doc || !canView(doc, requester)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    file: {
      ...doc,
      myAccess: getFileAccess(doc, requester),
      canManageSharing: isOwnerOrAdmin(doc, requester),
    },
  });
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
    await ensureFileOwnersBackfilled();
    const doc = await FileModel.findById(id);
    if (!doc || !canView(doc, requester)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canEdit(doc, requester)) {
      return NextResponse.json({ error: "You don't have edit access to this file" }, { status: 403 });
    }

    const body = await req.json();
    const before = {
      filename: doc.filename,
      description: doc.description,
      tags: doc.tags,
      folderId: doc.folderId ? doc.folderId.toString() : null,
    };

    if (typeof body.filename === "string" && body.filename.trim()) {
      doc.filename = sanitizeFilename(body.filename);
    }
    if (typeof body.description === "string") {
      doc.description = sanitizeDescription(body.description);
    }
    if (body.tags !== undefined) {
      doc.tags = parseTags(body.tags);
    }
    if (body.folderId !== undefined) {
      if (body.folderId === null || body.folderId === "root") {
        doc.folderId = null;
      } else if (isValidObjectId(body.folderId)) {
        doc.folderId = body.folderId;
      } else {
        return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
      }
    }

    await doc.save();

    await logEvent({
      level: "info",
      action: "update",
      message: `Updated "${doc.filename}"`,
      fileId: doc._id.toString(),
      meta: {
        before,
        after: {
          filename: doc.filename,
          description: doc.description,
          tags: doc.tags,
          folderId: doc.folderId ? doc.folderId.toString() : null,
        },
      },
    });

    return NextResponse.json({ file: doc });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown update error";
    await logEvent({ level: "error", action: "update", message, fileId: id });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const requester = await requireUser(_req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await dbConnect();
    await ensureFileOwnersBackfilled();
    const doc = await FileModel.findById(id);
    if (!doc || !canView(doc, requester)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isOwnerOrAdmin(doc, requester)) {
      return NextResponse.json({ error: "Only the owner or an admin can delete this file" }, { status: 403 });
    }

    const bucket = await getBucket();
    try {
      await bucket.delete(doc.gridFsId);
    } catch {
      // File bytes may already be gone; still remove the metadata record.
    }

    // Revisions each own a permanent GridFS blob (see excel/route.ts and
    // revisions/restore/route.ts) — deleting the file must also reclaim those,
    // otherwise every past save/restore leaks storage forever.
    const revisions = await RevisionModel.find({ fileId: id }).select("gridFsId").lean();
    for (const rev of revisions) {
      try {
        await bucket.delete(rev.gridFsId);
      } catch {
        // Blob may already be gone; continue cleaning up the rest.
      }
    }
    await RevisionModel.deleteMany({ fileId: id });

    await doc.deleteOne();

    await logEvent({
      level: "info",
      action: "delete",
      message: `Deleted "${doc.filename}"`,
      fileId: id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown delete error";
    await logEvent({ level: "error", action: "delete", message, fileId: id });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
