import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import { logEvent } from "@/lib/logger";
import { isValidObjectId, sanitizeTag } from "@/lib/validation";
import { buildTextFilter } from "@/lib/search";
import type { FilterQuery } from "mongoose";
import type { IFile } from "@/models/File";

export const runtime = "nodejs";

function toCsvValue(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

const CSV_HEADER = ["filename", "originalName", "mimeType", "size", "tags", "description", "uploadedAt"];

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim().slice(0, 200) ?? "";
    const tag = sanitizeTag(searchParams.get("tag") ?? "");
    const folderId = searchParams.get("folderId");
    const format = searchParams.get("format") === "csv" ? "csv" : "json";

    const filter: FilterQuery<IFile> = {};
    const textFilters = q ? buildTextFilter(q) : [];
    if (textFilters.length > 0) filter.$and = textFilters;
    if (tag) filter.tags = tag;
    if (folderId === "root") filter.folderId = null;
    else if (folderId && isValidObjectId(folderId)) filter.folderId = folderId;

    // Streams rows out of a MongoDB cursor as they're read, instead of
    // loading every matching file into memory before writing a single byte
    // — matters once a search/folder has thousands of results.
    let count = 0;
    const nodeStream = new Readable({
      objectMode: false,
      read() {},
    });

    (async () => {
      const cursor = FileModel.find(filter).sort({ uploadedAt: -1 }).lean().cursor();
      try {
        if (format === "csv") {
          nodeStream.push(CSV_HEADER.map(toCsvValue).join(",") + "\r\n");
          for await (const it of cursor as AsyncIterable<IFile & { _id: unknown; uploadedAt: Date }>) {
            count++;
            const row = [
              it.filename,
              it.originalName,
              it.mimeType,
              String(it.size),
              it.tags.join("|"),
              it.description.replace(/\r?\n/g, " "),
              new Date(it.uploadedAt).toISOString(),
            ]
              .map(toCsvValue)
              .join(",");
            nodeStream.push(row + "\r\n");
          }
        } else {
          nodeStream.push("[");
          let first = true;
          for await (const it of cursor as AsyncIterable<unknown>) {
            count++;
            nodeStream.push((first ? "" : ",") + JSON.stringify(it, null, 2));
            first = false;
          }
          nodeStream.push("]");
        }
        nodeStream.push(null);
      } catch (err) {
        nodeStream.destroy(err instanceof Error ? err : new Error("Export stream error"));
      } finally {
        await logEvent({
          level: "info",
          action: "export",
          message: `Exported ${count} record(s) as ${format}`,
          meta: { q, tag, format },
        });
      }
    })();

    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="file-vault-export.${format}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown export error";
    await logEvent({ level: "error", action: "export", message });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
