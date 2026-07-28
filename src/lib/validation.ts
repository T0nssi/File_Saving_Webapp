export const MAX_FILE_SIZE = Number(
  process.env.NEXT_PUBLIC_MAX_FILE_SIZE ?? 25 * 1024 * 1024
); // 25MB default

export const MAX_FILES_PER_UPLOAD = 20;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_FOLDER_NAME_LENGTH = 80;

// Allowlist, not a denylist — safer default for arbitrary user uploads.
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/json",
];

/** Strips path separators and unsafe characters; keeps extension intact. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return cleaned || "file";
}

export function sanitizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

export function parseTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(",");
  const cleaned = raw.map(sanitizeTag).filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, MAX_TAGS);
}

/** Strips path separators; a folder name is a label, never a path. */
export function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[/\\]/g, "")
    .slice(0, MAX_FOLDER_NAME_LENGTH);
}

/** MongoDB ObjectId is a 24-char hex string — validate before any query. */
export function isValidObjectId(id: string): boolean {
  return /^[a-f\d]{24}$/i.test(id);
}

export function sanitizeDescription(desc: string): string {
  return desc.slice(0, MAX_DESCRIPTION_LENGTH);
}
