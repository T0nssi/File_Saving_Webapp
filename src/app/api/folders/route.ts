import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FolderModel from "@/models/Folder";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { isValidObjectId, sanitizeFolderName } from "@/lib/validation";
import { requireUser } from "@/lib/session";
import { accessFilter, ensureFileOwnersBackfilled } from "@/lib/filePermissions";

// Level-by-level, not the whole tree at once: the sidebar loads the root
// level up front, then fetches a folder's children only when it's expanded
// (?parentId=<id>), and each fetch's file/subfolder counts are scoped to
// just that level's folder ids — so a deep or wide vault doesn't mean
// scanning (or shipping to the client) every folder just to open the page.
//
// The folder tree itself is a shared namespace (not owned/private) — only
// the per-folder file counts are scoped to what the requester can access,
// so a member never sees a count that includes files they can't open.
export async function GET(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await dbConnect();
  await ensureFileOwnersBackfilled();
  const { searchParams } = new URL(req.url);

  if (searchParams.get("flat") === "1") {
    // Minimal payload (no counts, no aggregation) for populating "move to
    // folder" dropdowns and breadcrumb name lookups — those need every
    // folder's id/name/parent, but never its counts, so this stays cheap
    // even though it does span the whole tree.
    const folders = await FolderModel.find().select("_id name parentId").sort({ name: 1 }).lean();
    return NextResponse.json({ folders });
  }

  const parentIdParam = searchParams.get("parentId");
  let parentId: string | null = null;
  if (parentIdParam) {
    if (!isValidObjectId(parentIdParam)) {
      return NextResponse.json({ error: "Invalid parent folder" }, { status: 400 });
    }
    parentId = parentIdParam;
  }

  const levelFolders = await FolderModel.find({ parentId }).sort({ name: 1 }).lean();
  const levelIds = levelFolders.map((f) => f._id);
  const access = accessFilter(requester);

  const [fileCounts, folderCounts, recursiveCounts, rootCount, vaultTotals] = await Promise.all([
    FileModel.aggregate([
      { $match: { $and: [{ folderId: { $in: levelIds } }, access] } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]),
    FolderModel.aggregate([
      { $match: { parentId: { $in: levelIds } } },
      { $group: { _id: "$parentId", count: { $sum: 1 } } },
    ]),
    // Recursive totals per folder at this level — every nested subfolder and
    // file underneath it, not just direct children — so the tree reads like
    // a VS Code explorer badge ("N folders · M files") instead of only
    // counting what's one level down.
    levelIds.length > 0
      ? FolderModel.aggregate([
          { $match: { _id: { $in: levelIds } } },
          {
            $graphLookup: {
              from: "folders",
              startWith: "$_id",
              connectFromField: "_id",
              connectToField: "parentId",
              as: "descendants",
            },
          },
          {
            $project: {
              allIds: { $concatArrays: [["$_id"], "$descendants._id"] },
              folderCountRecursive: { $size: "$descendants" },
            },
          },
          {
            $lookup: {
              from: "files",
              let: { ids: "$allIds" },
              pipeline: [{ $match: { $expr: { $in: ["$folderId", "$$ids"] }, ...access } }, { $count: "count" }],
              as: "fileCountResult",
            },
          },
          {
            $project: {
              folderCountRecursive: 1,
              fileCountRecursive: { $ifNull: [{ $arrayElemAt: ["$fileCountResult.count", 0] }, 0] },
            },
          },
        ])
      : Promise.resolve([]),
    parentId === null
      ? FileModel.countDocuments({ $and: [{ folderId: null }, access] })
      : Promise.resolve(undefined),
    // Vault-wide totals, shown on the "All files" root node — folders are a
    // shared namespace so the count is unscoped, but files are access-scoped
    // like everywhere else.
    parentId === null
      ? Promise.all([FolderModel.countDocuments({}), FileModel.countDocuments(access)])
      : Promise.resolve(undefined),
  ]);

  const fileCountMap = new Map<string, number>(fileCounts.map((c) => [String(c._id), c.count as number]));
  const folderCountMap = new Map<string, number>(folderCounts.map((c) => [String(c._id), c.count as number]));
  const recursiveMap = new Map<string, { fileCountRecursive: number; folderCountRecursive: number }>(
    recursiveCounts.map((c) => [
      String(c._id),
      { fileCountRecursive: c.fileCountRecursive as number, folderCountRecursive: c.folderCountRecursive as number },
    ])
  );

  return NextResponse.json({
    folders: levelFolders.map((f) => ({
      ...f,
      fileCount: fileCountMap.get(String(f._id)) ?? 0,
      childFolderCount: folderCountMap.get(String(f._id)) ?? 0,
      fileCountRecursive: recursiveMap.get(String(f._id))?.fileCountRecursive ?? 0,
      folderCountRecursive: recursiveMap.get(String(f._id))?.folderCountRecursive ?? 0,
    })),
    ...(parentId === null ? { rootCount } : {}),
    ...(parentId === null && vaultTotals
      ? { vaultTotals: { folderCount: vaultTotals[0], fileCount: vaultTotals[1] } }
      : {}),
  });
}

export async function POST(req: NextRequest) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const body = await req.json();
    const name = sanitizeFolderName(String(body.name ?? ""));
    if (!name) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    let parentId: string | null = null;
    if (body.parentId) {
      if (!isValidObjectId(body.parentId)) {
        return NextResponse.json({ error: "Invalid parent folder" }, { status: 400 });
      }
      const parent = await FolderModel.findById(body.parentId);
      if (!parent) {
        return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
      }
      parentId = body.parentId;
    }

    const folder = await FolderModel.create({ name, parentId });

    await logEvent({
      level: "info",
      action: "system",
      message: `Created folder "${name}"`,
      meta: { folderId: folder._id.toString(), parentId, by: requester.username },
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown folder error";
    await logEvent({ level: "error", action: "system", message });
    return NextResponse.json({ error: "Could not create folder" }, { status: 500 });
  }
}
