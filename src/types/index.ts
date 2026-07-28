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
  uploadedAt: string;
  updatedAt: string;
}

export interface FolderDoc {
  _id: string;
  name: string;
  parentId: string | null;
  fileCount?: number;
  childFolderCount?: number;
  createdAt?: string;
  updatedAt?: string;
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
