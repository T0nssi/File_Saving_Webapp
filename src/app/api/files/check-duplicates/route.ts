import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { accessFilter, ensureFileOwnersBackfilled } from "@/lib/filePermissions";
import { isValidObjectId, sanitizeFilename } from "@/lib/validation";

// Lets the upload page warn about a name collision before it happens, so the
// user can choose to version the existing file instead of silently getting
// two unrelated files with the same name. Scoped to exactly the destination
// folder plus `accessFilter(requester)` — never a bare filename lookup —
// so this can't be used to probe whether a same-named file exists in a
// folder the requester can't actually see into.
export async function POST(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.names)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const names = body.names.filter((n: unknown): n is string => typeof n === "string" && n.length > 0).slice(0, 200);
  if (names.length === 0) {
    return NextResponse.json({ duplicates: [] });
  }

  let folderId: string | null = null;
  if (body.folderId && body.folderId !== "root") {
    if (!isValidObjectId(body.folderId)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }
    folderId = body.folderId;
  }

  await dbConnect();
  await ensureFileOwnersBackfilled();

  // A duplicate only counts if it would collide with what actually gets
  // stored — match against the sanitized name, keyed back to whichever
  // original name(s) sanitize to it.
  const sanitizedToOriginals = new Map<string, string[]>();
  for (const n of names) {
    const safe = sanitizeFilename(n);
    const list = sanitizedToOriginals.get(safe);
    if (list) list.push(n);
    else sanitizedToOriginals.set(safe, [n]);
  }

  const matches = await FileModel.find({
    $and: [{ folderId }, { filename: { $in: [...sanitizedToOriginals.keys()] } }, accessFilter(requester)],
  })
    .select("_id filename size mimeType uploadedAt")
    .lean();

  const duplicates = matches.flatMap((m) =>
    (sanitizedToOriginals.get(m.filename) ?? []).map((originalName) => ({
      name: originalName,
      file: {
        _id: m._id.toString(),
        filename: m.filename,
        size: m.size,
        mimeType: m.mimeType,
        uploadedAt: m.uploadedAt,
      },
    }))
  );

  return NextResponse.json({ duplicates });
}
