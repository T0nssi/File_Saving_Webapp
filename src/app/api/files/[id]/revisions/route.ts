import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import RevisionModel from "@/models/Revision";
import FileModel from "@/models/File";
import { getBucket } from "@/lib/gridfs";
import { requireUser } from "@/lib/session";
import { canView, ensureFileOwnersBackfilled } from "@/lib/filePermissions";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await dbConnect();
    await ensureFileOwnersBackfilled();

    const file = await FileModel.findById(id);
    if (!file || !canView(file, requester)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const revisions = await RevisionModel.find({ fileId: id })
      .sort({ versionNumber: -1 })
      .limit(50)
      .lean();

    // Flag revisions whose GridFS blob is gone (a handful of older files still carry
    // revisions orphaned by a fixed bug where the old file was deleted before the
    // revision record referencing it was created) so the UI can disable "Restore" for them.
    let existingIds = new Set<string>();
    if (revisions.length > 0) {
      const bucket = await getBucket();
      const docs = await bucket
        .find({ _id: { $in: revisions.map((r) => r.gridFsId) } }, { projection: { _id: 1 } })
        .toArray();
      existingIds = new Set(docs.map((d) => d._id.toString()));
    }

    const revisionsWithAvailability = revisions.map((r) => ({
      ...r,
      fileAvailable: existingIds.has(r.gridFsId.toString()),
    }));

    return NextResponse.json({ revisions: revisionsWithAvailability });
  } catch (error) {
    console.error("Revisions fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revisions" },
      { status: 500 }
    );
  }
}
