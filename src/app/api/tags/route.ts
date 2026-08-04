import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { accessFilter, ensureFileOwnersBackfilled } from "@/lib/filePermissions";

export async function GET(req: NextRequest) {
  const requester = await requireUser(req);
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await dbConnect();
  await ensureFileOwnersBackfilled();

  const tags = await FileModel.aggregate([
    { $match: accessFilter(requester) },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 200 },
  ]);

  return NextResponse.json({
    tags: tags.map((t) => ({ tag: t._id as string, count: t.count as number })),
  });
}
