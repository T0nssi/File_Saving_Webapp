"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Folder as FolderIcon, FolderPlus, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { PromptModal } from "@/components/Dialog";
import type { FolderDoc } from "@/types";

interface Props {
  fileId: string;
  defaultFilename: string;
  currentFolderId: string | null;
  // Which editor page to land on after cloning — the clone always keeps the
  // same file type as its source, so the destination page is the same kind.
  redirectPrefix: "/edit" | "/excel";
  onClose: () => void;
}

// Shared by the edit page and the Excel editor page — same "Save As" flow
// (new filename + destination folder, with search and create-new) for
// either file type, so the two can't drift out of sync with each other.
export default function SaveAsDialog({ fileId, defaultFilename, currentFolderId, redirectPrefix, onClose }: Props) {
  const router = useRouter();
  const [filename, setFilename] = useState(defaultFilename);
  const [folderId, setFolderId] = useState<string>(currentFolderId ?? "root");
  const [folders, setFolders] = useState<FolderDoc[]>([]);
  const [folderQuery, setFolderQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/folders?flat=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { folders: FolderDoc[] } | null) => setFolders(data?.folders ?? []))
      .catch(() => {});
  }, []);

  const folderPathById = useMemo(() => {
    const byId = new Map(folders.map((f) => [f._id, f]));
    const paths = new Map<string, string>();
    function pathOf(fid: string): string {
      if (paths.has(fid)) return paths.get(fid)!;
      const f = byId.get(fid);
      if (!f) return "";
      const parentPath = f.parentId ? pathOf(f.parentId) : "";
      const full = parentPath ? `${parentPath} / ${f.name}` : f.name;
      paths.set(fid, full);
      return full;
    }
    folders.forEach((f) => pathOf(f._id));
    return paths;
  }, [folders]);

  const folderSearchResults = useMemo(() => {
    const q = folderQuery.trim().toLowerCase();
    if (!q) return [];
    return folders.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 50);
  }, [folderQuery, folders]);

  const selectedFolderLabel = folderId === "root" ? "ยังไม่จัดหมวด" : folderPathById.get(folderId) ?? "ยังไม่จัดหมวด";

  async function createFolder(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolderError(null);

    const existing = folders.find((f) => !f.parentId && f.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setFolderId(existing._id);
      setShowNewFolder(false);
      return;
    }

    try {
      const res = await apiFetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFolderError(data.error ?? "Could not create folder");
        return;
      }
      setFolders((prev) => [...prev, data.folder].sort((a, b) => a.name.localeCompare(b.name)));
      setFolderId(data.folder._id);
      setShowNewFolder(false);
    } catch {
      setFolderError("Network error — is the server running?");
    }
  }

  async function handleClone() {
    if (!filename.trim()) {
      setError("Filename cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${fileId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newFilename: filename.trim(),
          folderId: folderId === "root" ? null : folderId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Clone failed");
      } else {
        router.push(`${redirectPrefix}/${data.file._id}`);
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => !saving && onClose()}>
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-lg"
        >
          <h2 className="mb-4 text-lg font-semibold">Save File As</h2>

          <label className="mb-1.5 block text-sm font-medium">Filename</label>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="New filename"
            className="mb-4 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleClone();
              if (e.key === "Escape") onClose();
            }}
            autoFocus
          />

          <label className="mb-1.5 block text-sm font-medium">Destination folder</label>
          <p className="mb-1.5 text-xs text-[var(--color-muted)]">
            เลือกแล้ว: <span className="font-medium text-[var(--color-text)]">{selectedFolderLabel}</span>
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                value={folderQuery}
                onChange={(e) => setFolderQuery(e.target.value)}
                placeholder="ค้นหาโฟลเดอร์…"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-8 text-sm outline-none focus-visible:border-[var(--color-accent)]"
              />
              {folderQuery && (
                <button
                  type="button"
                  aria-label="Clear folder search"
                  onClick={() => setFolderQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted)] hover:bg-zinc-100"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setFolderError(null);
                setShowNewFolder(true);
              }}
              title="สร้างโฟลเดอร์ใหม่ (จะสร้างที่ระดับบนสุด)"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
            >
              <FolderPlus size={16} /> ใหม่
            </button>
          </div>

          {folderQuery.trim() ? (
            <div className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-[var(--color-border)] p-1">
              {folderSearchResults.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-[var(--color-muted)]">ไม่พบโฟลเดอร์ที่ตรงกัน</p>
              ) : (
                folderSearchResults.map((f) => (
                  <button
                    key={f._id}
                    type="button"
                    onClick={() => {
                      setFolderId(f._id);
                      setFolderQuery("");
                    }}
                    className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100"
                  >
                    <span className="flex items-center gap-1.5 text-sm">
                      <FolderIcon size={13} className="text-[var(--color-muted)]" />
                      {f.name}
                    </span>
                    <span className="truncate pl-5 text-[11px] text-[var(--color-muted)]">
                      {folderPathById.get(f._id) || f.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            >
              <option value="root">ยังไม่จัดหมวด</option>
              {folders.map((f) => (
                <option key={f._id} value={f._id}>
                  {folderPathById.get(f._id) || f.name}
                </option>
              ))}
            </select>
          )}
          {folderError && <p className="mt-1 text-xs text-[var(--color-danger)]">{folderError}</p>}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleClone}
              disabled={saving}
              className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create Copy"}
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {showNewFolder && (
        <PromptModal
          title="ชื่อโฟลเดอร์ใหม่ (จะสร้างที่ระดับบนสุด)"
          submitLabel="สร้าง"
          onSubmit={createFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </>
  );
}
