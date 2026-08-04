import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { requireUser } from "@/lib/session";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  isValidObjectId,
  parseTags,
  sanitizeDescription,
  sanitizeFilename,
} from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();

    const formData = await req.formData();
    const incoming = formData.getAll("files").filter((f): f is File => f instanceof File);
    const description = sanitizeDescription(String(formData.get("description") ?? ""));
    const tags = parseTags(String(formData.get("tags") ?? ""));
    const folderIdRaw = String(formData.get("folderId") ?? "");
    const folderId = folderIdRaw && isValidObjectId(folderIdRaw) ? folderIdRaw : null;
    const uploadedBy = requester.username;

    if (incoming.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (incoming.length > MAX_FILES_PER_UPLOAD) {
      return NextResponse.json(
        { error: `Too many files. Max ${MAX_FILES_PER_UPLOAD} per upload.` },
        { status: 400 }
      );
    }

    const bucket = await getBucket();
    const saved = [];
    const rejected: { name: string; reason: string }[] = [];

    for (const file of incoming) {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push({ name: file.name, reason: "exceeds max file size" });
        continue;
      }
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        rejected.push({ name: file.name, reason: `type "${file.type}" not allowed` });
        continue;
      }

      const safeName = sanitizeFilename(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());

      const gridId = await new Promise<import("mongodb").ObjectId>((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(safeName, {
          contentType: file.type,
        });
        Readable.from(buffer)
          .pipe(uploadStream)
          .on("error", reject)
          .on("finish", () => resolve(uploadStream.id));
      });

      const doc = await FileModel.create({
        filename: safeName,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        gridFsId: gridId,
        tags,
        description,
        folderId,
        uploadedBy,
        ownerId: requester.id,
      });

      await logEvent({
        level: "info",
        action: "upload",
        message: `Uploaded "${safeName}" (${file.size} bytes)`,
        fileId: doc._id.toString(),
        meta: { tags, mimeType: file.type, folderId, uploadedBy },
      });

      saved.push(doc);
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
