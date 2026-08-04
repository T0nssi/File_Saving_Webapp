import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { canView, ensureFileOwnersBackfilled } from "@/lib/filePermissions";
import { getBucket } from "@/lib/gridfs";
import { Readable } from "stream";
import type mongoose from "mongoose";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { newFilename } = await req.json();

    if (!newFilename || typeof newFilename !== "string") {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    await dbConnect();
    await ensureFileOwnersBackfilled();

    const sourceFile = await FileModel.findById(id);
    if (!sourceFile || !canView(sourceFile, requester)) {
      // Same response whether the file is missing or just inaccessible —
      // don't reveal that a file a requester can't see exists at all.
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const bucket = await getBucket();

    // Download source file
    const downloadStream = bucket.openDownloadStream(sourceFile.gridFsId);
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Upload as new file
    const uploadStream = bucket.openUploadStream(newFilename);
    let uploadedId: mongoose.Types.ObjectId | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        uploadStream.on("error", reject);
        const readable = Readable.from([buffer]);
        readable.pipe(uploadStream, { end: true });
        uploadStream.on("finish", () => resolve());
      });

      uploadedId = uploadStream.id as mongoose.Types.ObjectId;
      if (!uploadedId) {
        throw new Error("Upload did not return a valid file ID");
      }

      // Create new file record. If sourceFile is itself a clone, point at its
      // master rather than chaining — "master" should always resolve in one hop.
      const masterFileId = sourceFile.sourceFileId ?? sourceFile._id;
      const newFile = new FileModel({
        filename: newFilename,
        originalName: newFilename,
        mimeType: sourceFile.mimeType,
        size: buffer.length,
        gridFsId: uploadedId,
        tags: sourceFile.tags,
        description: `Copy of ${sourceFile.filename}`,
        folderId: sourceFile.folderId,
        uploadedBy: requester.username,
        ownerId: requester.id,
        sourceFileId: masterFileId,
      });

      await newFile.save();

      return NextResponse.json({
        success: true,
        file: newFile.toObject(),
      });
    } catch (err) {
      // Roll back the orphaned upload so GridFS doesn't leak storage on failure.
      if (uploadedId) {
        try {
          await bucket.delete(uploadedId);
        } catch {
          // Best effort cleanup only
        }
      }
      throw err;
    }
  } catch (error) {
    console.error("File clone error:", error);
    return NextResponse.json(
      { error: "Failed to clone file" },
      { status: 500 }
    );
  }
}
