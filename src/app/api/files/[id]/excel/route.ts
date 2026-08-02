import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { requireUser } from "@/lib/session";
import { getBucket } from "@/lib/gridfs";
import { Readable } from "stream";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file || (!file.mimeType.includes("spreadsheet") && !file.mimeType.includes("excel"))) {
      return NextResponse.json({ error: "File not found or not an Excel file" }, { status: 404 });
    }

    const bucket = await getBucket();
    const downloadStream = bucket.openDownloadStream(file.gridFsId);

    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        return { name: sheetName, data: [Array(10).fill("")] };
      }
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];
      return {
        name: sheetName,
        data: data.length ? data : [Array(10).fill("")],
      };
    });

    return NextResponse.json({ sheets });
  } catch (error) {
    console.error("Excel read error:", error);
    return NextResponse.json(
      { error: "Failed to read Excel file" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { sheets } = await req.json();

    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const isExcel = file.mimeType.includes("spreadsheet") || file.mimeType.includes("excel");
    if (!isExcel) {
      return NextResponse.json({ error: "Not an Excel file" }, { status: 400 });
    }

    const workbook = XLSX.utils.book_new();
    sheets.forEach((sheet: { name: string; data: string[][] }) => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const bucket = await getBucket();

    // Delete old file
    try {
      await bucket.delete(file.gridFsId);
    } catch (err) {
      // Ignore if file doesn't exist
    }

    // Upload new file and wait for the ID
    const uploadStream = bucket.openUploadStream(file.originalName);

    await new Promise<void>((resolve, reject) => {
      uploadStream.on("error", reject);
      const readable = Readable.from([buffer]);
      readable.pipe(uploadStream, { end: true });
      uploadStream.on("finish", () => resolve());
    });

    // Update file record
    file.size = buffer.length;
    file.gridFsId = uploadStream.id;
    await file.save();

    return NextResponse.json({
      success: true,
      file: file.toObject(),
    });
  } catch (error) {
    console.error("Excel save error:", error);
    return NextResponse.json(
      { error: "Failed to save Excel file" },
      { status: 500 }
    );
  }
}
