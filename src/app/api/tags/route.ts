import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";

export async function GET() {
  await dbConnect();

  const tags = await FileModel.aggregate([
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 200 },
  ]);

  return NextResponse.json({
    tags: tags.map((t) => ({ tag: t._id as string, count: t.count as number })),
  });
}
