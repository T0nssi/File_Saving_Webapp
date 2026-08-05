import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import busboy from "busboy";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { requireUser, CurrentUser } from "@/lib/session";
import {
  isAllowedUpload,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  isValidObjectId,
  parseTags,
  sanitizeDescription,
  sanitizeFilename,
} from "@/lib/validation";
import type { GridFSBucket } from "mongodb";

export const runtime = "nodejs";

interface RejectedFile {
  name: string;
  reason: string;
}

// Streams the multipart body straight into GridFS as it arrives, instead of
// buffering the whole request (req.formData()) and then the whole file again
// (file.arrayBuffer()) in memory before writing anything — that double-buffer
// approach caps uploads at whatever fits in RAM twice over, which rules out
// anything beyond a couple hundred MB on a typical server. This keeps memory
// use bounded by chunk size regardless of file size, so multi-GB uploads are
// limited by MAX_FILE_SIZE_BYTES and available disk, not RAM.
function parseUpload(
  req: NextRequest,
  bucket: GridFSBucket,
  requester: CurrentUser
): Promise<{ saved: unknown[]; rejected: RejectedFile[] }> {
  return new Promise((resolve, reject) => {
    if (!req.body) {
      resolve({ saved: [], rejected: [] });
      return;
    }

    const bb = busboy({
      headers: Object.fromEntries(req.headers),
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD },
    });

    const fields: Record<string, string> = {};
    const saved: unknown[] = [];
    const rejected: RejectedFile[] = [];
    const pending: Promise<void>[] = [];
    // Tracked so a parse-level error (e.g. the client disconnects mid-upload)
    // can abort any GridFS writes still in flight instead of leaving them
    // stuck open indefinitely, waiting for a 'finish' that will never come.
    const activeUploads = new Set<ReturnType<GridFSBucket["openUploadStream"]>>();
    let filesLimitHit = false;

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("filesLimit", () => {
      filesLimitHit = true;
    });

    bb.on("file", (_fieldname, fileStream, info) => {
      const { filename, mimeType } = info;

      if (!isAllowedUpload(mimeType, filename)) {
        rejected.push({ name: filename, reason: `type "${mimeType}" not allowed` });
        fileStream.resume(); // drain without storing
        return;
      }

      const safeName = sanitizeFilename(filename);
      const uploadStream = bucket.openUploadStream(safeName, { contentType: mimeType });
      activeUploads.add(uploadStream);

      const task = new Promise<void>((resolveTask) => {
        let truncated = false;
        fileStream.on("limit", () => {
          truncated = true;
          uploadStream.destroy(new Error("size limit exceeded"));
        });

        uploadStream.on("error", async () => {
          activeUploads.delete(uploadStream);
          try {
            await bucket.delete(uploadStream.id);
          } catch {
            // Nothing was written, or already gone — fine either way.
          }
          rejected.push({
            name: filename,
            reason: truncated ? "exceeds max file size" : "upload error",
          });
          resolveTask();
        });

        uploadStream.on("finish", async () => {
          activeUploads.delete(uploadStream);
          try {
            const folderIdRaw = fields.folderId ?? "";
            const folderId = folderIdRaw && isValidObjectId(folderIdRaw) ? folderIdRaw : null;
            const doc = await FileModel.create({
              filename: safeName,
              originalName: filename,
              mimeType,
              size: uploadStream.length,
              gridFsId: uploadStream.id,
              tags: parseTags(fields.tags ?? ""),
              description: sanitizeDescription(fields.description ?? ""),
              folderId,
              uploadedBy: requester.username,
              ownerId: requester.id,
            });
            await logEvent({
              level: "info",
              action: "upload",
              message: `Uploaded "${safeName}" (${uploadStream.length} bytes)`,
              fileId: doc._id.toString(),
              meta: { mimeType, folderId, uploadedBy: requester.username },
            });
            saved.push(doc);
          } catch (err) {
            try {
              await bucket.delete(uploadStream.id);
            } catch {
              // Best-effort cleanup only.
            }
            const message = err instanceof Error ? err.message : "database error";
            rejected.push({ name: filename, reason: message });
          }
          resolveTask();
        });

        fileStream.pipe(uploadStream);
      });

      pending.push(task);
    });

    bb.on("error", (err) => {
      for (const stream of activeUploads) {
        stream.destroy(new Error("upload aborted"));
      }
      reject(err instanceof Error ? err : new Error("Upload parse error"));
    });

    bb.on("close", async () => {
      await Promise.all(pending);
      if (filesLimitHit) {
        rejected.push({ name: "(additional files)", reason: `exceeds max ${MAX_FILES_PER_UPLOAD} files per upload` });
      }
      resolve({ saved, rejected });
    });

    Readable.fromWeb(req.body as import("stream/web").ReadableStream).pipe(bb);
  });
}

export async function POST(req: NextRequest) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    await dbConnect();
    const bucket = await getBucket();

    const { saved, rejected } = await parseUpload(req, bucket, requester);

    if (saved.length === 0 && rejected.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    for (const r of rejected) {
      await logEvent({
        level: "warn",
        action: "upload",
        message: `Rejected "${r.name}": ${r.reason}`,
      });
    }

    return NextResponse.json({ saved, rejected }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown upload error";
    await logEvent({ level: "error", action: "upload", message });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
