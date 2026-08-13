import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import RevisionModel from "@/models/Revision";
import { requireUser } from "@/lib/session";
import { canEdit, canView, ensureFileOwnersBackfilled } from "@/lib/filePermissions";
import { getBucket } from "@/lib/gridfs";
import { getCellAddress } from "@/lib/excelUtils";
import { claimNextVersion } from "@/lib/revisionVersion";
import { MAX_EXCEL_FILE_SIZE } from "@/lib/validation";
import { Readable } from "stream";
import type mongoose from "mongoose";

interface Params {
  params: Promise<{ id: string }>;
}

// exceljs bundles its own minimal `declare interface Buffer extends ArrayBuffer {}`
// stub (see node_modules/exceljs/index.d.ts) instead of relying on @types/node's
// real Buffer type, and that stub is stricter about ArrayBuffer-only members
// (resizable, maxByteLength, ...) than a real Node Buffer actually has — a known
// upstream typing gap, not a real runtime mismatch (a real Buffer works fine here).
async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

interface Sheet {
  name: string;
  data: string[][];
}

interface CellChange {
  cell: string;
  sheet: string;
  oldValue: string;
  newValue: string;
}

// Security constants — MAX_FILE_SIZE comes from lib/validation.ts (env-configurable
// via MAX_EXCEL_FILE_SIZE_BYTES / MAX_FILE_SIZE_BYTES) so it isn't a second,
// disconnected cap a file could clear on upload but then be unopenable here.
const MAX_FILE_SIZE = MAX_EXCEL_FILE_SIZE;
const MAX_ROWS = 10000;
const MAX_COLS = 500;
const MAX_SHEETS = 50;

// Reads every worksheet in a workbook into the plain string[][] grid the
// client and the rest of this route work with — the single source of truth
// for "workbook -> Sheet[]", used both to answer GET and to snapshot the
// previous content in POST for change-tracking, so the two can't drift.
function workbookToSheets(workbook: ExcelJS.Workbook): Sheet[] {
  return workbook.worksheets.map((worksheet) => {
    // Fail fast on a workbook that's oversized before materializing any
    // arrays — actualRowCount/columnCount reflect genuinely populated
    // cells (unlike a stale declared range), so this can't be defeated by
    // a file that just claims a huge range without real content in it.
    if (worksheet.rowCount > MAX_ROWS) {
      throw new Error(`Sheet "${worksheet.name}" exceeds maximum rows (${MAX_ROWS})`);
    }
    if (worksheet.columnCount > MAX_COLS) {
      throw new Error(`Sheet "${worksheet.name}" exceeds maximum columns (${MAX_COLS})`);
    }

    let data: string[][] = [];
    for (let r = 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const rowData: string[] = [];
      for (let c = 1; c <= worksheet.columnCount; c++) {
        rowData.push(row.getCell(c).text ?? "");
      }
      data.push(rowData);
    }

    // Trim trailing empty rows
    while (data.length > 0 && data[data.length - 1]?.every((cell) => !cell)) {
      data.pop();
    }

    if (data.length === 0) {
      return { name: worksheet.name, data: [Array(10).fill("")] };
    }

    // Trim trailing empty columns
    const maxCols = Math.max(...data.map((row) => row.length));
    let actualMaxCols = 0;
    for (let col = 0; col < maxCols; col++) {
      const hasValue = data.some((row) => row[col]);
      if (hasValue) actualMaxCols = col + 1;
    }

    // Normalize rows to have consistent column count
    data = data.map((row) => {
      const normalized = [...row];
      while (normalized.length < actualMaxCols) normalized.push("");
      return normalized.slice(0, actualMaxCols);
    });

    return { name: worksheet.name, data: data.length ? data : [Array(10).fill("")] };
  });
}

// Compare old and new data and return list of changes
function compareSheetData(
  oldSheets: Sheet[],
  newSheets: Sheet[]
): CellChange[] {
  const changes: CellChange[] = [];

  newSheets.forEach((newSheet, sheetIdx) => {
    const oldSheet = oldSheets[sheetIdx];
    if (!oldSheet) return;

    // Compare each cell
    newSheet.data.forEach((row, rowIdx) => {
      row.forEach((newValue, colIdx) => {
        const oldValue = oldSheet.data[rowIdx]?.[colIdx] ?? "";

        // Only record if value actually changed
        if (newValue !== oldValue) {
          changes.push({
            cell: getCellAddress(rowIdx, colIdx),
            sheet: newSheet.name,
            oldValue: oldValue,
            newValue: newValue,
          });
        }
      });
    });
  });

  return changes;
}

// Generate human-readable summary of changes
function generateChangesSummary(changes: CellChange[]): string {
  if (changes.length === 0) {
    return "No changes";
  }

  if (changes.length === 1) {
    const c = changes[0]!;
    const oldDisplay = c.oldValue ? `"${c.oldValue}"` : "(empty)";
    const newDisplay = c.newValue ? `"${c.newValue}"` : "(empty)";
    return `${c.sheet}!${c.cell}: ${oldDisplay} → ${newDisplay}`;
  }

  // Group by sheet
  const bySheet: Record<string, CellChange[]> = {};
  changes.forEach((change) => {
    if (!bySheet[change.sheet]) {
      bySheet[change.sheet] = [];
    }
    bySheet[change.sheet]!.push(change);
  });

  const summaryParts: string[] = [];
  Object.entries(bySheet).forEach(([sheetName, sheetChanges]) => {
    if (sheetChanges.length <= 3) {
      // Show individual cells if only a few changes
      const cells = sheetChanges
        .map((c) => `${c.cell} (${c.oldValue || "∅"} → ${c.newValue || "∅"})`)
        .join(", ");
      summaryParts.push(`${sheetName}: ${cells}`);
    } else {
      // Show count if many changes
      summaryParts.push(`${sheetName}: ${sheetChanges.length} cells changed`);
    }
  });

  return summaryParts.join(" | ");
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const requester = await requireUser(req);
    if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await dbConnect();
    await ensureFileOwnersBackfilled();

    const file = await FileModel.findById(id);
    if (!file || (!file.mimeType.includes("spreadsheet") && !file.mimeType.includes("excel"))) {
      return NextResponse.json({ error: "File not found or not an Excel file" }, { status: 404 });
    }
    if (!canView(file, requester)) {
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
    const workbook = await loadWorkbook(buffer);

    // Security: Check number of sheets
    if (workbook.worksheets.length > MAX_SHEETS) {
      return NextResponse.json(
        { error: `File contains too many sheets (max ${MAX_SHEETS})` },
        { status: 400 }
      );
    }

    const sheets = workbookToSheets(workbook);

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

        // Check columns across every row, not just the first (ragged arrays)
        const maxRowLength = normalizedData.reduce((max, row) => Math.max(max, row.length), 0);
        if (maxRowLength > MAX_COLS) {
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

    // Duplicate sheet name check (case-insensitive, matches Excel's own rule)
    const seenNames = new Set<string>();
    for (const sheet of sheets) {
      const key = sheet.name.trim().toLowerCase();
      if (seenNames.has(key)) {
        return NextResponse.json({ error: `Duplicate sheet name: "${sheet.name}"` }, { status: 400 });
      }
      seenNames.add(key);
    }

    await dbConnect();
    await ensureFileOwnersBackfilled();

    const file = await FileModel.findById(id);
    if (!file || !canView(file, requester)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!canEdit(file, requester)) {
      return NextResponse.json({ error: "You don't have edit access to this file" }, { status: 403 });
    }

    const isExcel = file.mimeType.includes("spreadsheet") || file.mimeType.includes("excel");
    if (!isExcel) {
      return NextResponse.json({ error: "Not an Excel file" }, { status: 400 });
    }

    // Read original file BEFORE deleting to preserve formatting and styling.
    // The loaded workbook itself becomes the base we write back out (mutated
    // in place) — every sheet, style, and workbook-level property we don't
    // explicitly touch below survives untouched, which is a lot simpler (and
    // more complete) than manually copying properties field by field.
    const bucket = await getBucket();
    let originalWorkbook: ExcelJS.Workbook | null = null;
    let oldSheets: Sheet[] = [];
    let styleWarning = false;

    try {
      const downloadStream = bucket.openDownloadStream(file.gridFsId);
      const chunks: Buffer[] = [];
      for await (const chunk of downloadStream) {
        chunks.push(chunk);
      }
      const originalBuffer = Buffer.concat(chunks);
      originalWorkbook = await loadWorkbook(originalBuffer);
      oldSheets = workbookToSheets(originalWorkbook);
    } catch (err) {
      console.warn("Could not read original file for styling preservation:", err);
      styleWarning = true;
      originalWorkbook = null;
    }

    const outputWorkbook = originalWorkbook ?? new ExcelJS.Workbook();

    // Original sheets keep their position across a rename (the editor never
    // reorders or deletes sheets — only "clone" appends one), so matching by
    // index rather than by name is what lets a renamed sheet keep its
    // original formatting instead of looking like a brand-new sheet.
    if (originalWorkbook) {
      while (outputWorkbook.worksheets.length > sheets.length) {
        const extra = outputWorkbook.worksheets[outputWorkbook.worksheets.length - 1]!;
        outputWorkbook.removeWorksheet(extra.name);
      }
    }

    sheets.forEach((sheet, idx) => {
      let worksheet = outputWorkbook.worksheets[idx];
      if (worksheet) {
        worksheet.name = sheet.name;
      } else {
        // New sheet (cloned client-side) — no original to copy formatting from.
        worksheet = outputWorkbook.addWorksheet(sheet.name);
      }

      sheet.data.forEach((row, rowIdx) => {
        row.forEach((value, colIdx) => {
          const cell = worksheet.getCell(rowIdx + 1, colIdx + 1);
          // Clear the value but keep the cell's style — matches how a
          // spreadsheet normally treats "delete contents" vs. "clear all".
          cell.value = value === "" ? null : value;
        });
      });
    });

    const buffer = Buffer.from(await outputWorkbook.xlsx.writeBuffer());

    // Security: Check resulting file size
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Generated file exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Save current file reference BEFORE uploading new file
    const oldGridFsId = file.gridFsId;
    const oldSize = file.size;

    // Upload new file and wait for the ID
    const uploadStream = bucket.openUploadStream(file.originalName);
    let uploadedId: mongoose.Types.ObjectId | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        uploadStream.on("error", reject);
        const readable = Readable.from([buffer]);
        readable.pipe(uploadStream, { end: true });
        uploadStream.on("finish", () => resolve());
      });

      uploadedId = uploadStream.id as mongoose.Types.ObjectId;
      if (!uploadedId) {
        throw new Error("Upload did not return a valid file ID");
      }

      // Atomically claim the next version number so concurrent saves never collide.
      const nextVersion = await claimNextVersion(id);

      // Generate detailed change summary
      let changesSummary = `Edited by ${requester.username}`;
      if (oldSheets.length > 0) {
        const changes = compareSheetData(oldSheets, sheets);
        changesSummary = generateChangesSummary(changes);
      } else if (styleWarning) {
        changesSummary = `Edited by ${requester.username} (formatting could not be verified)`;
      }

      // Create revision of old file (before update)
      const revision = new RevisionModel({
        fileId: id,
        versionNumber: nextVersion,
        gridFsId: oldGridFsId,
        changedBy: requester.username,
        changesSummary: changesSummary,
        size: oldSize,
      });
      await revision.save();

      // Now update file record with new content
      file.size = buffer.length;
      file.gridFsId = uploadedId;
      file.currentVersion = nextVersion;
      await file.save();

      // Note: oldGridFsId is NOT deleted — the revision just created above now owns
      // that blob as its permanent snapshot. Deleting it here would break the
      // revision the moment it's created.

      return NextResponse.json({
        success: true,
        file: file.toObject(),
        version: nextVersion,
        styleWarning,
      });
    } catch (err) {
      // Roll back the orphaned upload so GridFS doesn't leak storage on failure.
      if (uploadedId) {
        try {
          await bucket.delete(uploadedId);
        } catch {
          // Best effort cleanup only
        }
      }
      throw err;
    }
  } catch (error) {
    console.error("Excel save error:", error);
    return NextResponse.json(
      { error: "Failed to save Excel file" },
      { status: 500 }
    );
  }
}
