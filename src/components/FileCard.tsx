"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Trash2, Pencil, Eye, FolderInput, Sheet, Copy, Share2, Users } from "lucide-react";
import { formatBytes } from "@/lib/format";
import ShareDialog from "@/components/ShareDialog";
import type { FileDoc, FolderDoc } from "@/types";

interface Props {
  file: FileDoc;
  folders: FolderDoc[];
  onDelete: (id: string) => void;
  onPreview: (file: FileDoc) => void;
  onMove: (id: string, folderId: string | null) => void;
}

export default function FileCard({ file, folders, onDelete, onPreview, onMove }: Props) {
  const [showShare, setShowShare] = useState(false);
  const isImage = file.mimeType.startsWith("image/");
  const isExcel = file.mimeType.includes("spreadsheet") || file.mimeType.includes("excel") || file.filename.endsWith(".xlsx") || file.filename.endsWith(".xls");

  // Defaults are display-only guards (hide/disable buttons); the server enforces
  // the real permission on every mutating request regardless of what's shown here.
  const canEdit = file.myAccess === "edit";
  const canManageSharing = file.canManageSharing ?? false;
  const isSharedWithMe = file.myAccess === "view";

  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", file._id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <button
        type="button"
        onClick={() => onPreview(file)}
        className="flex h-36 w-full items-center justify-center bg-zinc-50"
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${file._id}/download`}
            alt={file.filename}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : isExcel ? (
          <Sheet size={32} className="text-green-600" />
        ) : (
          <FileText size={32} className="text-[var(--color-muted)]" />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="flex items-center gap-1 truncate text-sm font-medium" title={file.filename}>
          {file.sourceFileId && (
            <Copy size={11} className="shrink-0 text-[var(--color-muted)]" aria-label="Cloned file" />
          )}
          <span className="truncate">{file.filename}</span>
        </p>
        {file.description && (
          <p className="line-clamp-2 text-xs text-[var(--color-muted)]">{file.description}</p>
        )}
        {file.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {file.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {file.uploadedBy && (
            <p className="text-[10px] text-[var(--color-muted)]">อัพโหลดโดย {file.uploadedBy}</p>
          )}
          {isSharedWithMe && (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <Users size={9} /> Shared with you
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <FolderInput size={12} className="shrink-0 text-[var(--color-muted)]" />
          <select
            aria-label={`Move ${file.filename} to folder`}
            value={file.folderId ?? "root"}
            disabled={!canEdit}
            onChange={(e) => onMove(file._id, e.target.value === "root" ? null : e.target.value)}
            className="w-full truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[11px] outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-50"
          >
            <option value="root">ยังไม่จัดหมวด</option>
            {folders.map((f) => (
              <option key={f._id} value={f._id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-[10px] text-[var(--color-muted)]">
            {formatBytes(file.size)} · {new Date(file.uploadedAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Preview ${file.filename}`}
              onClick={() => onPreview(file)}
              className="rounded p-1.5 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-accent)]"
            >
              <Eye size={14} />
            </button>
            {canManageSharing && (
              <button
                type="button"
                aria-label={`Share ${file.filename}`}
                onClick={() => setShowShare(true)}
                className="rounded p-1.5 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-accent)]"
              >
                <Share2 size={14} />
              </button>
            )}
            {canEdit && (isExcel ? (
              <Link
                href={`/excel/${file._id}`}
                aria-label={`Edit Excel ${file.filename}`}
                className="rounded p-1.5 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-green-600"
              >
                <Sheet size={14} />
              </Link>
            ) : (
              <Link
                href={`/edit/${file._id}`}
                aria-label={`Edit ${file.filename}`}
                className="rounded p-1.5 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-accent)]"
              >
                <Pencil size={14} />
              </Link>
            ))}
            {canManageSharing && (
              <button
                type="button"
                aria-label={`Delete ${file.filename}`}
                onClick={() => onDelete(file._id)}
                className="rounded p-1.5 text-[var(--color-muted)] hover:bg-red-50 hover:text-[var(--color-danger)]"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {showShare && (
        <ShareDialog fileId={file._id} filename={file.filename} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
