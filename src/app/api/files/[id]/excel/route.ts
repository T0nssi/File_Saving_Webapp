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
  // exceljs only reads the modern zip-based .xlsx format, not the legacy
  // binary .xls format (OLE Compound File signature D0 CF 11 E0 A1 B1 1A E1)
  // that the old xlsx library used to read transparently. Detect it up
  // front and say so plainly, instead of letting a generic "not a valid
  // zip file" parse error surface (or, worse, silently show an empty grid).
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new Error(
      "This file is in the older .xls format, which the Excel editor can't open. Re-save it as .xlsx (in Excel: File > Save As > Excel Workbook) and re-upload."
    );
  }
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

interface StructuralOp {
  type: "row" | "col";
  sheetIndex: number;
  position: number;
}

const MAX_STRUCTURAL_OPS = 500;

// Parses "A1" -> { row: 1, col: 1 } (1-based, matching exceljs's own addressing).
function parseCellAddr(addr: string): { row: number; col: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Unparseable cell address: ${addr}`);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2]!, 10), col };
}

function colLetters(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

// Shifts (or, if the insertion point falls strictly inside the range,
// expands) a merge range for a row/column inserted at `position` — mirrors
// how a real spreadsheet treats an insert that lands inside vs. before an
// existing merge.
function shiftMergeRange(range: string, axis: "row" | "col", position: number): string {
  const [a, b] = range.split(":");
  const s = parseCellAddr(a!);
  const e = parseCellAddr(b!);
  const key = axis === "row" ? "row" : "col";
  let ns = s[key];
  let ne = e[key];
  if (position <= s[key]) {
    ns += 1;
    ne += 1;
  } else if (position <= e[key]) {
    ne += 1;
  }
  const newS = { ...s, [key]: ns };
  const newE = { ...e, [key]: ne };
  return `${colLetters(newS.col)}${newS.row}:${colLetters(newE.col)}${newE.row}`;
}

// exceljs's spliceColumns (and, less predictably, spliceRows) mishandle
// merged cells directly — verified spliceColumns can silently relocate a
// cell's value to the wrong address entirely and leave the <mergeCells>
// declaration stale, producing a file Excel's own strict parser rejects as
// corrupt on open. Unmerging everything first removes the merge state that
// confuses the splice, then the shifted/expanded ranges are recomputed and
// reapplied manually afterward — full control, no dependence on exceljs's
// internal (and here, buggy) merge-splice interaction.
function safeSplice(worksheet: ExcelJS.Worksheet, type: "row" | "col", position: number): void {
  const merges = [...worksheet.model.merges];
  merges.forEach((range) => worksheet.unMergeCells(range));
  if (type === "row") {
    worksheet.spliceRows(position + 1, 0, []);
  } else {
    worksheet.spliceColumns(position + 1, 0, []);
  }
  merges.forEach((range) => {
    worksheet.mergeCells(shiftMergeRange(range, type, position + 1));
  });
}

// Security constants — MAX_FILE_SIZE comes from lib/validation.ts (env-configurable
// via MAX_EXCEL_FILE_SIZE_BYTES / MAX_FILE_SIZE_BYTES) so it isn't a second,
// disconnected cap a file could clear on upload but then be unopenable here.
const MAX_FILE_SIZE = MAX_EXCEL_FILE_SIZE;
const MAX_ROWS = 10000;
const MAX_COLS = 500;
const MAX_SHEETS = 50;

// exceljs's own Cell#text getter can throw for a non-master cell inside a
// merged range whose master cell is empty: internally it resolves to the
// master's value and calls .toString() on it unconditionally, and an empty
// master's value is `null` — "Cannot read properties of null (reading
// 'toString')". Merging cells with no content in the top-left one (a blank
// spacer row, a header that got cleared, ...) is completely ordinary, so
// this isn't a rare edge case. Read cell.value first — safe, never calls
// .toString() — and only fall through to .text (with the crash still
// guarded, in case some other cell shape has a similar quirk) when there's
// actually something there.
function cellText(cell: ExcelJS.Cell): string {
  if (cell.value === null || cell.value === undefined) return "";
  try {
    return cell.text ?? "";
  } catch {
    return "";
  }
}

// A defined name's range is stored as a literal string like `Data!$A$1:$B$2`
// or `'Laser Marking'!$A$1:$B$2` (quoted when the sheet name has spaces/
// special characters). Replaces the leading sheet-name reference with
// `newName` — preserving/adding quoting as needed — iff it currently
// references `oldName`; otherwise returns the string unchanged.
function replaceSheetNameInRange(rangeStr: string, oldName: string, newName: string): string {
  const bangIdx = rangeStr.indexOf("!");
  if (bangIdx === -1) return rangeStr;
  const sheetRef = rangeStr.slice(0, bangIdx);
  const rest = rangeStr.slice(bangIdx);
  let bareName = sheetRef;
  let quoted = false;
  if (sheetRef.startsWith("'") && sheetRef.endsWith("'")) {
    quoted = true;
    bareName = sheetRef.slice(1, -1).replace(/''/g, "'");
  }
  if (bareName !== oldName) return rangeStr;
  const needsQuote = quoted || /[^A-Za-z0-9_]/.test(newName);
  const newSheetRef = needsQuote ? `'${newName.replace(/'/g, "''")}'` : newName;
  return newSheetRef + rest;
}

// exceljs keeps the special built-in `_xlnm.Print_Area`/AutoFilter defined
// names in sync with a renamed worksheet automatically (they're regenerated
// live from the worksheet object), but a *custom* named range — one the
// workbook's original author added, e.g. "DataRange" pointing at
// `Data!$A$1:$B$2` — keeps the literal old sheet-name text verbatim even
// after `worksheet.name = "Laser Marking"` above. Reloading a file with a
// dangling reference like that is exactly what makes Excel's own repair
// flow report "Removed Records: Named range from /xl/workbook.xml part
// (Workbook)" on open. Rewrite every custom defined name's ranges so any
// reference to a renamed sheet follows the rename instead of going stale.
function fixDefinedNamesAfterRename(workbook: ExcelJS.Workbook, renameMap: Map<string, string>): void {
  if (renameMap.size === 0) return;
  const model = workbook.definedNames.model;
  if (model.length === 0) return;
  workbook.definedNames.model = model.map((dn) => ({
    ...dn,
    ranges: dn.ranges.map((r) => {
      for (const [oldName, newName] of renameMap) {
        const replaced = replaceSheetNameInRange(r, oldName, newName);
        if (replaced !== r) return replaced;
      }
      return r;
    }),
  }));
}

// Reads every worksheet in a workbook into the plain string[][] grid the
// client and the rest of this route work with — the single source of truth
// for "workbook -> Sheet[]", used both to answer GET and to snapshot the
// previous content in POST for change-tracking, so the two can't drift.
function workbookToSheets(workbook: ExcelJS.Workbook): Sheet[] {
  return workbook.worksheets.map((worksheet) => {
    // Deliberately NOT pre-checking worksheet.rowCount/columnCount against
    // MAX_ROWS/MAX_COLS here: those getters reflect the highest row/column
    // that has *any* cell record, including cells that only carry styling
    // (e.g. borders or fill applied across a wide "just in case" range,
    // very common in real-world spreadsheets) with no actual value — a tiny
    // 2-row table can easily report rowCount in the thousands that way.
    // Checking real size only after trimming (below, same as the limit
    // check further down) is what actually reflects the data being sent
    // to the client, and matches how this worked before this rewrite.
    let data: string[][] = [];
    for (let r = 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const rowData: string[] = [];
      for (let c = 1; c <= worksheet.columnCount; c++) {
        rowData.push(cellText(row.getCell(c)));
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

    // Security: check dimensions of the actual (trimmed) content, not the
    // raw declared range — see the comment above.
    if (data.length > MAX_ROWS) {
      throw new Error(`Sheet "${worksheet.name}" exceeds maximum rows (${MAX_ROWS})`);
    }
    if (actualMaxCols > MAX_COLS) {
      throw new Error(`Sheet "${worksheet.name}" exceeds maximum columns (${MAX_COLS})`);
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
    const { sheets: inputSheets, structuralOps: rawOps } = await req.json();

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

    // Row/column inserts (as opposed to addRow/addColumn, which only ever
    // append and need no special handling — see workbookToSheets/the write
    // loop below) — each op says "physically shift everything from this
    // position onward" on a specific sheet, applied in order further down.
    let structuralOps: StructuralOp[] = [];
    if (rawOps !== undefined) {
      if (!Array.isArray(rawOps) || rawOps.length > MAX_STRUCTURAL_OPS) {
        return NextResponse.json({ error: "Invalid structural operations" }, { status: 400 });
      }
      try {
        structuralOps = rawOps.map((op: unknown) => {
          if (
            !op ||
            typeof op !== "object" ||
            ((op as { type?: unknown }).type !== "row" && (op as { type?: unknown }).type !== "col") ||
            !Number.isInteger((op as { sheetIndex?: unknown }).sheetIndex) ||
            !Number.isInteger((op as { position?: unknown }).position)
          ) {
            throw new Error("Invalid structural operation");
          }
          const typed = op as { type: "row" | "col"; sheetIndex: number; position: number };
          if (typed.sheetIndex < 0 || typed.sheetIndex >= sheets.length) {
            throw new Error("Invalid structural operation");
          }
          const maxPos = typed.type === "row" ? MAX_ROWS : MAX_COLS;
          if (typed.position < 0 || typed.position > maxPos) {
            throw new Error("Invalid structural operation");
          }
          return typed;
        });
      } catch {
        return NextResponse.json({ error: "Invalid structural operations" }, { status: 400 });
      }
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

    // Match/rename/create every sheet first (positionally), before touching
    // any cell — structural ops below need the right worksheet objects to
    // already exist, and value-writing needs the ops already applied.
    const renamedSheets = new Map<string, string>();
    const worksheets = sheets.map((sheet, idx) => {
      let worksheet = outputWorkbook.worksheets[idx];
      if (worksheet) {
        if (worksheet.name !== sheet.name) renamedSheets.set(worksheet.name, sheet.name);
        worksheet.name = sheet.name;
      } else {
        // New sheet (cloned client-side) — no original to copy formatting from.
        worksheet = outputWorkbook.addWorksheet(sheet.name);
      }
      return worksheet;
    });
    fixDefinedNamesAfterRename(outputWorkbook, renamedSheets);

    // Physically shift existing rows/columns (styles and merges included)
    // out of the way for each insert, in the same order the user performed
    // them — this is what positional value-writing alone can't do for a
    // mid-sheet insert (an append at the end needs none of this, see
    // workbookToSheets). Goes through safeSplice, not exceljs's spliceRows/
    // spliceColumns directly — see that function for why.
    for (const op of structuralOps) {
      const worksheet = worksheets[op.sheetIndex];
      if (!worksheet) continue; // already bounds-checked above; defensive only
      safeSplice(worksheet, op.type, op.position);
    }

    sheets.forEach((sheet, idx) => {
      const worksheet = worksheets[idx]!;
      sheet.data.forEach((row, rowIdx) => {
        row.forEach((value, colIdx) => {
          const cell = worksheet.getCell(rowIdx + 1, colIdx + 1);
          // A non-master cell inside a merged range doesn't hold its own
          // value — reading it duplicates the master's text (see
          // workbookToSheets/cellText), and setting it redirects the write
          // to the master cell instead. Since every cell in the merge gets
          // written here in order, that redirect meant whichever slave
          // happened to be processed *last* silently overwrote whatever an
          // earlier one (including a real edit) had just set — the merge's
          // saved content was effectively random depending on its size and
          // position, not what was actually typed. Skipping slave cells
          // entirely and writing only the merge's one real value (at its
          // master) makes this deterministic: edit the top-left cell of a
          // merge to change it, edits elsewhere inside the same merge don't
          // silently overwrite that.
          if (cell.type === ExcelJS.ValueType.Merge) return;
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
