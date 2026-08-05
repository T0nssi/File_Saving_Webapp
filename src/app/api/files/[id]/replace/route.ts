import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import busboy from "busboy";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";
import { requireUser } from "@/lib/session";
import { canEdit, canView, ensureFileOwnersBackfilled } from "@/lib/filePermissions";
import { claimNextVersion } from "@/lib/revisionVersion";
import { isAllowedUpload, isValidObjectId, MAX_FILE_SIZE, sanitizeFilename } from "@/lib/validation";
import type { GridFSBucket } from "mongodb";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

interface StreamedUpload {
  gridFsId: import("mongodb").ObjectId;
  size: number;
  mimeType: string;
}

// Replaces an image's content with a new upload, recording the previous
// content as a restorable revision — the same git-style history the Excel
// editor has, but for images. Scoped to images only: the current file must
// already be image/*, and the replacement must be image/* too. Other file
// types don't get this (per product decision) and this also keeps the
// endpoint from becoming a generic "swap any file's bytes" backdoor that
// bypasses type-specific validation elsewhere (e.g. the Excel editor's own
// row/column limits).
//
// Streams the single file part straight into GridFS as it arrives — same
// reasoning as upload/route.ts: buffering it fully in memory first would
// reintroduce the OOM risk that was fixed there, and MAX_FILE_SIZE_BYTES
// can be configured up to GB scale.
function parseAndStream(req: NextRequest, bucket: GridFSBucket, targetFilename: string): Promise<StreamedUpload | null> {
  return new Promise((resolve, reject) => {
    if (!req.body) {
      resolve(null);
      return;
    }

    const bb = busboy({
      headers: Object.fromEntries(req.headers),
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    let settled = false;

    bb.on("file", (_name, fileStream, info) => {
      if (settled) {
        fileStream.resume();
        return;
      }

      if (!info.mimeType.startsWith("image/") || !isAllowedUpload(info.mimeType, info.filename)) {
        settled = true;
        fileStream.resume();
        reject(new Error("Replacement must be an image file"));
        return;
      }

      const uploadStream = bucket.openUploadStream(targetFilename, { contentType: info.mimeType });
      let truncated = false;

      fileStream.on("limit", () => {
        truncated = true;
        uploadStream.destroy(new Error("exceeds max file size"));
      });

      uploadStream.on("error", async (err) => {
        settled = true;
        try {
          await bucket.delete(uploadStream.id);
        } catch {
          // Nothing was written, or already gone — fine either way.
        }
        reject(truncated ? new Error("exceeds max file size") : err);
      });

      uploadStream.on("finish", () => {
        settled = true;
        resolve({ gridFsId: uploadStream.id, size: uploadStream.length, mimeType: info.mimeType });
      });

      fileStream.pipe(uploadStream);
    });

    bb.on("error", (err) => {
      if (!settled) reject(err instanceof Error ? err : new Error("Upload parse error"));
    });

    bb.on("close", () => {
      if (!settled) resolve(null); // no file part was ever seen
    });

    Readable.fromWeb(req.body as import("stream/web").ReadableStream).pipe(bb);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await dbConnect();
    await ensureFileOwnersBackfilled();
    const file = await FileModel.findById(id);
    if (!file || !canView(file, requester)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canEdit(file, requester)) {
      return NextResponse.json({ error: "You don't have edit access to this file" }, { status: 403 });
    }
    if (!file.mimeType.startsWith("image/")) {
      return NextResponse.json({ error: "Version history is only available for images" }, { status: 400 });
    }

    const bucket = await getBucket();
    let uploaded: StreamedUpload | null;
    try {
      uploaded = await parseAndStream(req, bucket, sanitizeFilename(file.originalName));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (!uploaded) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const oldGridFsId = file.gridFsId;
    const oldSize = file.size;

    try {
      const nextVersion = await claimNextVersion(id);

      const revision = new RevisionModel({
        fileId: id,
        versionNumber: nextVersion,
        gridFsId: oldGridFsId,
        changedBy: requester.username,
        changesSummary: `Replaced image (${(oldSize / 1024).toFixed(1)} KB → ${(uploaded.size / 1024).toFixed(1)} KB)`,
        size: oldSize,
      });
      await revision.save();

      file.gridFsId = uploaded.gridFsId;
      file.size = uploaded.size;
      file.mimeType = uploaded.mimeType;
      file.currentVersion = nextVersion;
      await file.save();

      // Note: oldGridFsId is NOT deleted — the revision just created above
      // now owns that blob as its permanent snapshot (see excel/route.ts for
      // the same reasoning and the bug this pattern fixed there).

      return NextResponse.json({ success: true, file: file.toObject(), version: nextVersion });
    } catch (err) {
      try {
        await bucket.delete(uploaded.gridFsId);
      } catch {
        // Best-effort cleanup only.
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Image replace error:", message);
    return NextResponse.json({ error: "Failed to replace image" }, { status: 500 });
  }
}
