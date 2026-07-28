"use client";

import { useState } from "react";
import { Folder } from "lucide-react";
import type { FolderDoc } from "@/types";

interface Props {
  folders: FolderDoc[];
  onOpen: (folderId: string) => void;
  onDropFile: (fileId: string, folderId: string) => void;
}

/** Desktop-style folder icons: a big folder glyph with the name underneath,
 * arranged in a grid. Click to open, or drag a file card onto one to file
 * it there — the same interaction as a Finder/Explorer window. */
export default function FolderGrid({ folders, onOpen, onDropFile }: Props) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  if (folders.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {folders.map((f) => (
        <button
          key={f._id}
          type="button"
          onClick={() => onOpen(f._id)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("text/plain")) return;
            e.preventDefault();
            setDragOverId(f._id);
          }}
          onDragLeave={() => setDragOverId((id) => (id === f._id ? null : id))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const fileId = e.dataTransfer.getData("text/plain");
            if (fileId) onDropFile(fileId, f._id);
          }}
          className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
            dragOverId === f._id
              ? "border-[var(--color-accent)] bg-blue-50"
              : "border-transparent hover:bg-zinc-100"
          }`}
        >
          <Folder size={40} className="text-[var(--color-accent)]" strokeWidth={1.5} fill="currentColor" fillOpacity={0.12} />
          <span className="w-full truncate text-xs font-medium">{f.name}</span>
          <span className="text-[10px] text-[var(--color-muted)]">{f.fileCount} ไฟล์</span>
        </button>
      ))}
    </div>
  );
}
