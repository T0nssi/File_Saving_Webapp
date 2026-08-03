import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import RevisionModel from "@/models/Revision";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { getBucket } from "@/lib/gridfs";
import { Readable } from "stream";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { versionNumber } = await req.json();

    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const revision = await RevisionModel.findOne({ fileId: id, versionNumber });
    if (!revision) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    const bucket = await getBucket();

    // Read revision file
    const downloadStream = bucket.openDownloadStream(revision.gridFsId);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      downloadStream.on("data", (chunk) => chunks.push(chunk));
      downloadStream.on("end", () => resolve());
      downloadStream.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);

    // Delete current file
    try {
      await bucket.delete(file.gridFsId);
    } catch (err) {
      // Ignore if file doesn't exist
    }

    // Upload restored file
    const uploadStream = bucket.openUploadStream(file.originalName);

    await new Promise<void>((resolve, reject) => {
      uploadStream.on("error", reject);
      const readable = Readable.from([buffer]);
      readable.pipe(uploadStream, { end: true });
      uploadStream.on("finish", () => resolve());
    });

    // Update file record with new gridFsId
    file.gridFsId = uploadStream.id;
    file.updatedAt = new Date();
    await file.save();

    return NextResponse.json({
      success: true,
      file: file.toObject(),
    });
  } catch (error) {
    console.error("Revision restore error:", error);
    return NextResponse.json(
      { error: "Failed to restore revision" },
      { status: 500 }
    );
  }
}
