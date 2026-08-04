export type SharePermission = "view" | "edit";

export interface FileShareEntry {
  userId: string;
  permission: SharePermission;
  sharedAt: string;
}

export interface FileDoc {
  _id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  gridFsId: string;
  tags: string[];
  description: string;
  folderId: string | null;
  uploadedBy: string;
  currentVersion?: number;
  // Set only on files created via Save As / clone — the master file this one was cloned from.
  sourceFileId?: string | null;
  ownerId?: string | null;
  sharedWith?: FileShareEntry[];
  // Present when the API scoped this response to the requester's own access —
  // neither field is stored on the document itself. "edit" also covers
  // ownership/admin; canManageSharing is stricter (owner or admin only).
  myAccess?: SharePermission | null;
  canManageSharing?: boolean;
  uploadedAt: string;
  updatedAt: string;
}

// Response shape for GET/POST /api/files/[id]/shares (resolved to usernames,
// distinct from the raw userId-only FileShareEntry stored on the document).
export interface ResolvedShare {
  userId: string;
  username: string;
  permission: SharePermission;
  sharedAt: string;
}

export interface FolderDoc {
  _id: string;
  name: string;
  parentId: string | null;
  fileCount?: number;
  childFolderCount?: number;
  // Totals across the whole subtree (every nested folder/file), not just
  // direct children — only present on non-flat GET /api/folders responses.
  fileCountRecursive?: number;
  folderCountRecursive?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface VaultTotals {
  folderCount: number;
  fileCount: number;
}

export type LogLevel = "info" | "warn" | "error";
export type LogAction =
  | "upload"
  | "update"
  | "delete"
  | "export"
  | "search"
  | "system";

export interface LogDoc {
  _id: string;
  level: LogLevel;
  action: LogAction;
  message: string;
  meta?: Record<string, unknown>;
  fileId?: string;
  createdAt: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface RevisionDoc {
  _id: string;
  fileId: string;
  versionNumber: number;
  gridFsId: string;
  changedBy: string;
  changesSummary: string;
  size: number;
  createdAt: string;
  // False when the underlying GridFS blob is missing (e.g. orphaned by a fixed
  // historical bug); such revisions can be viewed in history but not restored.
  fileAvailable?: boolean;
}
