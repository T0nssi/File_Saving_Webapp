import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { dbConnect } from "@/lib/mongodb";
import { getBucket } from "@/lib/gridfs";
import FileModel from "@/models/File";
import { isValidObjectId } from "@/lib/validation";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await dbConnect();
  const doc = await FileModel.findById(id).lean();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bucket = await getBucket();
    const nodeStream = bucket.openDownloadStream(doc.gridFsId);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const disposition =
      new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline";

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(doc.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream error";
    await logEvent({ level: "error", action: "system", message, fileId: id });
    return NextResponse.json({ error: "Could not stream file" }, { status: 500 });
  }
}
