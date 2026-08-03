import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";
import { requireUser } from "@/lib/session";
import { getBucket } from "@/lib/gridfs";
import { Readable } from "stream";

interface Params {
  params: Promise<{ id: string }>;
}

interface Sheet {
  name: string;
  data: string[][];
}

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 10000;
const MAX_COLS = 500;
const MAX_SHEETS = 50;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file || (!file.mimeType.includes("spreadsheet") && !file.mimeType.includes("excel"))) {
      return NextResponse.json({ error: "File not found or not an Excel file" }, { status: 404 });
    }

    // Security: Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const bucket = await getBucket();
    const downloadStream = bucket.openDownloadStream(file.gridFsId);

    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Security: Check number of sheets
    if (workbook.SheetNames.length > MAX_SHEETS) {
      return NextResponse.json(
        { error: `File contains too many sheets (max ${MAX_SHEETS})` },
        { status: 400 }
      );
    }

    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        return { name: sheetName, data: [Array(10).fill("")] };
      }
      let data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

      // Trim trailing empty rows
      while (data.length > 0 && data[data.length - 1]?.every(cell => !cell)) {
        data.pop();
      }

      // If no data, show empty grid
      if (data.length === 0) {
        return { name: sheetName, data: [Array(10).fill("")] };
      }

      // Trim trailing empty columns
      let maxCols = Math.max(...data.map(row => row.length));
      let actualMaxCols = 0;
      for (let col = 0; col < maxCols; col++) {
        const hasValue = data.some(row => row[col]);
        if (hasValue) actualMaxCols = col + 1;
      }

      // Normalize rows to have consistent column count
      data = data.map(row => {
        const normalized = [...row];
        while (normalized.length < actualMaxCols) {
          normalized.push("");
        }
        return normalized.slice(0, actualMaxCols);
      });

      // Security: Check sheet dimensions
      if (data.length > MAX_ROWS) {
        throw new Error(`Sheet "${sheetName}" exceeds maximum rows (${MAX_ROWS})`);
      }
      if (actualMaxCols > MAX_COLS) {
        throw new Error(`Sheet "${sheetName}" exceeds maximum columns (${MAX_COLS})`);
      }

      return {
        name: sheetName,
        data: data.length ? data : [Array(10).fill("")],
      };
    });

    return NextResponse.json({ sheets });
  } catch (error) {
    console.error("Excel read error:", error);
    const message = error instanceof Error ? error.message : "Failed to read Excel file";
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && message.includes("exceeds") ? 400 : 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { sheets: inputSheets } = await req.json();

    // Security: Validate sheets input
    if (!Array.isArray(inputSheets) || inputSheets.length === 0) {
      return NextResponse.json({ error: "Invalid sheets data" }, { status: 400 });
    }

    if (inputSheets.length > MAX_SHEETS) {
      return NextResponse.json(
        { error: `Too many sheets (max ${MAX_SHEETS})` },
        { status: 400 }
      );
    }

    // Validate and normalize each sheet
    let sheets: Sheet[];
    try {
      sheets = inputSheets.map((sheet: { name: string; data: any[][] }) => {
        if (!sheet.name || !Array.isArray(sheet.data)) {
          throw new Error("Invalid sheet format");
        }
        if (sheet.data.length > MAX_ROWS) {
          throw new Error(`Sheet exceeds maximum rows (${MAX_ROWS})`);
        }

        // Normalize data: convert all values to strings, null/undefined to empty strings
        const normalizedData = sheet.data.map((row) =>
          row.map((cell) => {
            if (cell === null || cell === undefined) return "";
            return String(cell);
          })
        );

        // Check columns
        if (normalizedData[0] && normalizedData[0].length > MAX_COLS) {
          throw new Error(`Sheet exceeds maximum columns (${MAX_COLS})`);
        }

        return {
          name: sheet.name,
          data: normalizedData,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Validation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    await dbConnect();

    const file = await FileModel.findById(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const isExcel = file.mimeType.includes("spreadsheet") || file.mimeType.includes("excel");
    if (!isExcel) {
      return NextResponse.json({ error: "Not an Excel file" }, { status: 400 });
    }

    // Read original file BEFORE deleting to preserve formatting and styling
    const bucket = await getBucket();
    let originalWorkbook: XLSX.WorkBook | null = null;

    try {
      const downloadStream = bucket.openDownloadStream(file.gridFsId);
      const chunks: Buffer[] = [];
      for await (const chunk of downloadStream) {
        chunks.push(chunk);
      }
      const originalBuffer = Buffer.concat(chunks);
      originalWorkbook = XLSX.read(originalBuffer, { type: "buffer" });
    } catch (err) {
      console.warn("Could not read original file for styling preservation");
    }

    // Update sheets with new data while preserving original formatting
    const workbook = XLSX.utils.book_new();
    sheets.forEach((sheet: { name: string; data: string[][] }) => {
      // Find original sheet to copy formatting
      const originalSheet = originalWorkbook?.Sheets[sheet.name];

      if (originalSheet) {
        // Start with a deep copy of the original sheet to preserve ALL formatting
        const newWorksheet: any = {};

        // Copy all non-cell properties first (merges, column widths, row heights, etc)
        Object.keys(originalSheet).forEach((key) => {
          // These are metadata keys that should always be copied
          if (key.startsWith("!")) {
            newWorksheet[key] = JSON.parse(JSON.stringify(originalSheet[key]));
          }
        });

        // Now update cell values with new data while keeping formatting
        sheet.data.forEach((row, rowIdx) => {
          row.forEach((value, colIdx) => {
            const XLSX_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            let colName = "";
            let col = colIdx;
            while (col >= 0) {
              colName = XLSX_letters[col % 26] + colName;
              col = Math.floor(col / 26) - 1;
            }
            const cellAddress = colName + (rowIdx + 1);

            // Get original cell to preserve style
            const originalCell = originalSheet[cellAddress];

            if (originalCell && originalCell.s) {
              // Preserve original cell with updated value
              newWorksheet[cellAddress] = {
                v: value,
                t: "s",
                s: originalCell.s,
              };
            } else {
              // Simple cell without style
              newWorksheet[cellAddress] = {
                v: value,
                t: "s",
              };
            }
          });
        });

        // Ensure we have the required range property
        if (!newWorksheet["!ref"]) {
          const maxCol = Math.max(...sheet.data.map(row => row.length));
          newWorksheet["!ref"] = `A1:${String.fromCharCode(64 + maxCol)}${sheet.data.length}`;
        }

        XLSX.utils.book_append_sheet(workbook, newWorksheet, sheet.name);
      } else {
        // Sheet doesn't exist in original, create new one
        const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
      }
    });

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Security: Check resulting file size
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Generated file exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

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

    // Get previous revision count for version numbering
    const previousRevisions = await RevisionModel.find({ fileId: id }).sort({ versionNumber: -1 }).limit(1);
    const nextVersion = (previousRevisions[0]?.versionNumber ?? 0) + 1;

    // Save current file as a revision BEFORE we update it
    const oldGridFsId = file.gridFsId;
    const oldSize = file.size;

    // Create revision of old file (before update)
    const revision = new RevisionModel({
      fileId: id,
      versionNumber: nextVersion,
      gridFsId: oldGridFsId,
      changedBy: requester.username,
      changesSummary: `Edited by ${requester.username}`,
      size: oldSize,
    });
    await revision.save();

    // Now update file record with new content
    file.size = buffer.length;
    file.gridFsId = uploadStream.id;
    await file.save();

    return NextResponse.json({
      success: true,
      file: file.toObject(),
      version: nextVersion,
    });
  } catch (error) {
    console.error("Excel save error:", error);
    return NextResponse.json(
      { error: "Failed to save Excel file" },
      { status: 500 }
    );
  }
}
