import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { requireUser } from "@/lib/session";
import { accessFilter, ensureFileOwnersBackfilled, getFileAccess, isOwnerOrAdmin } from "@/lib/filePermissions";
import { isValidObjectId, sanitizeTag } from "@/lib/validation";
import { buildTextFilter } from "@/lib/search";
import type { FilterQuery } from "mongoose";
import type { IFile } from "@/models/File";

export async function GET(req: NextRequest) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    await ensureFileOwnersBackfilled();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim().slice(0, 200) ?? "";
    const tag = sanitizeTag(searchParams.get("tag") ?? "");
    const folderId = searchParams.get("folderId");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "24", 10) || 24));

    const filter: FilterQuery<IFile> = {};
    const textFilters = q ? buildTextFilter(q) : [];
    // Access scoping rides alongside the text-search clauses in the same $and —
    // for a non-admin this restricts results to files they own or are shared
    // with, regardless of what else the query matches.
    const access = accessFilter(requester);
    const andClauses: FilterQuery<IFile>[] = [...textFilters];
    if (Object.keys(access).length > 0) andClauses.push(access);
    if (andClauses.length > 0) filter.$and = andClauses;
    if (tag) filter.tags = tag;
    // No folderId param at all = browse every file regardless of folder.
    // folderId=root = only files not filed into any folder yet.
    // folderId=<id> = only files directly inside that folder.
    if (folderId === "root") filter.folderId = null;
    else if (folderId && isValidObjectId(folderId)) filter.folderId = folderId;

    const [items, total] = await Promise.all([
      FileModel.find(filter)
        .sort({ uploadedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      FileModel.countDocuments(filter),
    ]);

    if (q) {
      await logEvent({
        level: "info",
        action: "search",
        message: `Search query "${q}"${tag ? ` + tag "${tag}"` : ""}`,
        meta: { resultCount: total },
      });
    }

    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        myAccess: getFileAccess(item, requester),
        canManageSharing: isOwnerOrAdmin(item, requester),
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown search error";
    await logEvent({ level: "error", action: "search", message });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
