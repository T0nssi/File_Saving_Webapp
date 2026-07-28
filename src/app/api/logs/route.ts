import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Log from "@/models/Log";
import type { FilterQuery } from "mongoose";
import type { ILog } from "@/models/Log";

export async function GET(req: NextRequest) {
  await dbConnect();
  const { searchParams } = new URL(req.url);

  const level = searchParams.get("level");
  const action = searchParams.get("action");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

  const filter: FilterQuery<ILog> = {};
  if (level && ["info", "warn", "error"].includes(level)) filter.level = level as ILog["level"];
  if (action) filter.action = action as ILog["action"];

  const [items, total] = await Promise.all([
    Log.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Log.countDocuments(filter),
  ]);

  return NextResponse.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}
