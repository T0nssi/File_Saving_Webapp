import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";

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
let cached: { payload: StatsPayload; expiresAt: number } | null = null;

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  await dbConnect();

  const [agg, fileCount] = await Promise.all([
    FileModel.aggregate([{ $group: { _id: null, totalBytes: { $sum: "$size" } } }]),
    FileModel.countDocuments(),
  ]);
  const logicalBytes = agg[0]?.totalBytes ?? 0;

  // Best-effort: the actual bytes GridFS occupies on disk (file content
  // lives in the "chunks" collection, metadata in "files") — this can be
  // larger than the logical sum above due to chunk padding/overhead, and
  // isn't available on every MongoDB deployment/permission level, so this
  // is optional extra detail, not the primary number.
  let mongoStorageBytes: number | null = null;
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

  const payload: StatsPayload = { fileCount, logicalBytes, mongoStorageBytes };
  cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json(payload);
}
