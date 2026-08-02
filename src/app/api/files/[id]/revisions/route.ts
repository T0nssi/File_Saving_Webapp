import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import RevisionModel from "@/models/Revision";
import FileModel from "@/models/File";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const revisions = await RevisionModel.find({ fileId: id })
      .sort({ versionNumber: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({ revisions });
  } catch (error) {
    console.error("Revisions fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revisions" },
      { status: 500 }
    );
  }
}
