import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD } from "@/lib/validation";

// Lets the client read the server's *current* limits at runtime — these come
// from plain (non-NEXT_PUBLIC_) env vars specifically so an operator can
// change them with just an env edit + restart, no rebuild. Without this
// endpoint the client would have no way to know the current value at all.
export async function GET(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    maxFileSize: MAX_FILE_SIZE,
    maxFilesPerUpload: MAX_FILES_PER_UPLOAD,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
}
