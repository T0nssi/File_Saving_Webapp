import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import RevisionModel from "@/models/Revision";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
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

    // Upload restored file (before touching the current one, so a failure here leaves the file untouched)
    const uploadStream = bucket.openUploadStream(file.originalName);
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

      // Atomically claim the next version number so restore participates in the same counter as saves.
      const updatedForVersion = await FileModel.findByIdAndUpdate(
        id,
        { $inc: { currentVersion: 1 } },
        { new: true }
      );
      if (!updatedForVersion) {
        throw new Error("File not found during version update");
      }
      const nextVersion = updatedForVersion.currentVersion;

      // Record the restore itself as a new revision so history stays linear (git-style revert).
      const oldGridFsId = file.gridFsId;
      const oldSize = file.size;
      const restoreRevision = new RevisionModel({
        fileId: id,
        versionNumber: nextVersion,
        gridFsId: oldGridFsId,
        changedBy: requester.username,
        changesSummary: `Restored to version ${versionNumber} by ${requester.username}`,
        size: oldSize,
      });
      await restoreRevision.save();

      // Update file record with new gridFsId
      file.gridFsId = uploadedId;
      file.size = buffer.length;
      file.currentVersion = nextVersion;
      await file.save();

      // Delete previous current file only after everything succeeded
      try {
        await bucket.delete(oldGridFsId);
      } catch (err) {
        // Ignore if file doesn't exist
      }

      return NextResponse.json({
        success: true,
        file: file.toObject(),
        version: nextVersion,
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
    console.error("Revision restore error:", error);
    return NextResponse.json(
      { error: "Failed to restore revision" },
      { status: 500 }
    );
  }
}
