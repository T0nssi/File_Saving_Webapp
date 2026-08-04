"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, X, FileIcon, FolderUp } from "lucide-react";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Files picked via the folder input (or dragged in as a directory) carry this
// non-standard-but-universally-supported property, e.g. "Invoices/2026/a.xlsx".
// Files from a plain file pick/drop leave it as "".
export function relativeDir(f: File): string {
  const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export default function DropZone({ files, onChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory/directory aren't part of React's typed input props — set as
  // raw DOM attributes so this input offers folder selection, not just multi-file.
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return;
      const merged = [...files, ...Array.from(incoming)];
      onChange(merged);
    },
    [files, onChange]
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging
            ? "border-[var(--color-accent)] bg-blue-50"
            : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-zinc-50"
        }`}
      >
        <UploadCloud size={28} className="text-[var(--color-accent)]" />
        <p className="text-sm font-medium">Drag &amp; drop files here, or click to browse</p>
        <p className="text-xs text-[var(--color-muted)]">
          Images, PDFs, documents, spreadsheets, text and zip files
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            folderInputRef.current?.click();
          }}
          className="mt-1 flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          <FolderUp size={13} /> เลือกทั้งโฟลเดอร์ (จะสร้างโฟลเดอร์ให้อัตโนมัติ)
        </button>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {files.map((f, i) => {
            const dir = relativeDir(f);
            return (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 truncate">
                  <FileIcon size={14} className="shrink-0 text-[var(--color-muted)]" />
                  <span className="truncate">
                    {dir && <span className="text-[var(--color-muted)]">{dir}/</span>}
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">
                    {formatSize(f.size)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                  className="shrink-0 rounded p-1 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-danger)]"
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
