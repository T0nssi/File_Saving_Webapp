export type FileKind = "image" | "pdf" | "excel" | "cad" | "other";

const CAD_EXTENSIONS = [".dwg", ".dxf", ".step", ".stp"];

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

// Same classification used for the FileCard thumbnail and the preview modal,
// so "what icon do we show" and "can we preview this inline" never drift
// apart. CAD formats (DWG/DXF/STEP) intentionally get their own bucket with
// no inline preview — browsers can't render them, and DWG/STEP in particular
// need proprietary or very heavy tooling to do so at all.
export function getFileKind(mimeType: string, filename: string): FileKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls")
  ) {
    return "excel";
  }
  if (CAD_EXTENSIONS.includes(extensionOf(filename))) return "cad";
  return "other";
}
