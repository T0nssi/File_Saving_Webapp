import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { accessFilter, ensureFileOwnersBackfilled } from "@/lib/filePermissions";

interface CollStats {
  size?: number;
  storageSize?: number;
}

interface StatsPayload {
  fileCount: number;
  logicalBytes: number;
  mongoStorageBytes: number | null;
}

const CACHE_TTL_MS = 60_000;
// Module-level cache: survives across requests within one running server
// process (dev server, or a single long-lived instance). Storage totals
// don't need to be second-fresh, so this avoids re-running collStats (an
// admin-level command some managed MongoDB tiers throttle) on every page
// view. Note: on a multi-instance/serverless deployment each instance keeps
// its own cache, so this smooths out repeat hits rather than guaranteeing a
// single global refresh.
//
// Only cached for admins: it's the one case where the numbers are global
// (every file, not scoped to one requester), so a single cached payload is
// valid for every admin that asks. A member's numbers are scoped to what
// they can see, which differs per requester, so those are computed live.
let cachedAdminPayload: { payload: StatsPayload; expiresAt: number } | null = null;

export async function GET(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (requester.role === "admin" && cachedAdminPayload && cachedAdminPayload.expiresAt > Date.now()) {
    return NextResponse.json(cachedAdminPayload.payload);
  }

  await dbConnect();
  await ensureFileOwnersBackfilled();

  const filter = accessFilter(requester);
  const [agg, fileCount] = await Promise.all([
    FileModel.aggregate([{ $match: filter }, { $group: { _id: null, totalBytes: { $sum: "$size" } } }]),
    FileModel.countDocuments(filter),
  ]);
  const logicalBytes = agg[0]?.totalBytes ?? 0;

  // Best-effort: the actual bytes GridFS occupies on disk. This is a
  // collection-wide figure that can't be scoped to one requester's files, so
  // it's only meaningful (and only fetched) for an admin looking at the
  // whole vault.
  let mongoStorageBytes: number | null = null;
  if (requester.role === "admin") {
    try {
      const db = mongoose.connection.db;
      if (db) {
        const [filesStats, chunksStats] = await Promise.all([
          db.command({ collStats: "uploads.files" }) as Promise<CollStats>,
          db.command({ collStats: "uploads.chunks" }) as Promise<CollStats>,
        ]);
        mongoStorageBytes = (filesStats.storageSize ?? filesStats.size ?? 0) + (chunksStats.storageSize ?? chunksStats.size ?? 0);
      }
    } catch {
      mongoStorageBytes = null;
    }
  }

  const payload: StatsPayload = { fileCount, logicalBytes, mongoStorageBytes };
  if (requester.role === "admin") {
    cachedAdminPayload = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return NextResponse.json(payload);
}
