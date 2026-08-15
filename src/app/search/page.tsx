"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search as SearchIcon, Download, X, FileText, FileBox, Tag, CheckCircle2 } from "lucide-react";
import FileCard from "@/components/FileCard";
import FolderSidebar from "@/components/FolderSidebar";
import FolderGrid from "@/components/FolderGrid";
import StoragePanel from "@/components/StoragePanel";
import BulkTagDialog from "@/components/BulkTagDialog";
import { ConfirmModal } from "@/components/Dialog";
import { getCachedSearch, setCachedSearch } from "@/lib/searchCache";
import { apiFetch } from "@/lib/apiFetch";
import { getFileKind } from "@/lib/fileKind";
import type { FileDoc, FolderDoc, Paginated, TagCount } from "@/types";

const POLL_INTERVAL_MS = 15_000;

// Every filter (q, tag, folderId, page) lives in the URL, not just in local
// state. That's what makes the browser's Back/Forward buttons "remember"
// what you were looking at: each change replaces the current history entry,
// so navigating away and coming back restores the exact same search.
function SearchPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const urlTag = searchParams.get("tag") ?? "";
  const urlFolder = searchParams.get("folderId"); // null | "root" | <id>
  const urlPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  // Local mirror only for the text input, so typing feels instant; it's
  // debounced into the URL rather than pushed on every keystroke.
  const [qInput, setQInput] = useState(urlQ);
  const [tagsList, setTagsList] = useState<TagCount[]>([]);
  // Minimal id/name/parent list for every folder (no counts) — just enough
  // to populate FileCard's "move to folder" dropdown and the breadcrumb
  // label without repeating the heavier per-level count aggregation that
  // the sidebar/folder-icon views use.
  const [flatFolders, setFlatFolders] = useState<FolderDoc[]>([]);
  // Just the current level's subfolders, for the Desktop-style icon grid.
  const [subfolders, setSubfolders] = useState<FolderDoc[]>([]);
  const [foldersRefreshKey, setFoldersRefreshKey] = useState(0);
  const [data, setData] = useState<Paginated<FileDoc> | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<FileDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkTags, setShowBulkTags] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ updated: number; skipped: number } | null>(null);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role: string | null } | null) => setIsAdmin(d?.role === "admin"))
      .catch(() => {});
  }, []);

  function updateUrl(next: { q?: string; tag?: string; folderId?: string | null; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { q: urlQ, tag: urlTag, folderId: urlFolder, page: urlPage, ...next };

    if (merged.q) params.set("q", merged.q);
    else params.delete("q");

    if (merged.tag) params.set("tag", merged.tag);
    else params.delete("tag");

    if (merged.folderId) params.set("folderId", merged.folderId);
    else params.delete("folderId");

    if (merged.page && merged.page > 1) params.set("page", String(merged.page));
    else params.delete("page");

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Debounce free-text search into the URL so Back doesn't have to step
  // through every keystroke, while still keeping the final query in the URL.
  useEffect(() => {
    if (qInput === urlQ) return;
    const t = setTimeout(() => updateUrl({ q: qInput, page: 1 }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // Keep the text input in sync if the URL changes from elsewhere (e.g. the
  // user pressed Back and urlQ jumped to an older value).
  useEffect(() => {
    setQInput(urlQ);
  }, [urlQ]);

  const cacheKey = `${urlQ}|${urlTag}|${urlFolder ?? ""}|${urlPage}`;

  const fetchFiles = useCallback(
    async (opts?: { silent?: boolean }) => {
      // Stale-while-revalidate: a filter combination seen earlier in this
      // page load renders instantly from cache while a fresh copy loads
      // quietly behind it, instead of showing a spinner again for a view
      // the person already looked at (e.g. Back from Edit, or re-picking a
      // folder they were just in).
      const cached = getCachedSearch(cacheKey);
      if (cached && !opts?.silent) setData(cached);
      if (!cached && !opts?.silent) setLoading(true);

      const params = new URLSearchParams();
      if (urlQ) params.set("q", urlQ);
      if (urlTag) params.set("tag", urlTag);
      if (urlFolder) params.set("folderId", urlFolder);
      params.set("page", String(urlPage));
      try {
        const res = await apiFetch(`/api/files?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        setData(json);
        setCachedSearch(cacheKey, json);
      } finally {
        setLoading(false);
      }
    },
    [urlQ, urlTag, urlFolder, urlPage, cacheKey]
  );

  useEffect(() => {
    apiFetch("/api/tags")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { tags: TagCount[] } | null) => setTagsList(d?.tags ?? []))
      .catch(() => {});
  }, [foldersRefreshKey]);

  useEffect(() => {
    apiFetch("/api/folders?flat=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { folders: FolderDoc[] } | null) => setFlatFolders(d?.folders ?? []))
      .catch(() => {});
  }, [foldersRefreshKey]);

  // Desktop-style folder icons show the *current level's* subfolders: at
  // the top level that's every folder with no parent, inside a folder it's
  // that folder's direct children. The unfiled bucket ("root") isn't a real
  // folder, so it never has subfolders of its own. Fetched per-level rather
  // than filtered out of a full tree, matching the sidebar's lazy loading.
  useEffect(() => {
    if (urlFolder === "root") {
      setSubfolders([]);
      return;
    }
    const qs = urlFolder ? `?parentId=${urlFolder}` : "";
    apiFetch(`/api/folders${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { folders: FolderDoc[] } | null) => setSubfolders(d?.folders ?? []))
      .catch(() => {});
  }, [urlFolder, foldersRefreshKey]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Lightweight polling so a teammate's upload/move/delete shows up without
  // a manual refresh. Paused while the tab is hidden, and fetches quietly
  // (no loading flicker) so it doesn't interrupt whatever's on screen.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchFiles({ silent: true });
      setFoldersRefreshKey((k) => k + 1);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchFiles]);

  // A stale selection referencing files no longer on screen (folder change,
  // new search, page change) is confusing more than useful — clear it
  // whenever the visible set changes rather than trying to reconcile it.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [cacheKey]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete(id: string) {
    const name = data?.items.find((f) => f._id === id)?.filename ?? "ไฟล์นี้";
    setDeleteTarget({ id, name });
  }

  async function confirmDeleteFile() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    await apiFetch(`/api/files/${target.id}`, { method: "DELETE" });
    fetchFiles();
    setFoldersRefreshKey((k) => k + 1);
  }

  async function handleMove(id: string, folderId: string | null) {
    await apiFetch(`/api/files/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: folderId ?? "root" }),
    });
    fetchFiles();
    setFoldersRefreshKey((k) => k + 1);
  }

  function exportUrl(format: "csv" | "json") {
    const params = new URLSearchParams();
    if (urlQ) params.set("q", urlQ);
    if (urlTag) params.set("tag", urlTag);
    if (urlFolder) params.set("folderId", urlFolder);
    params.set("format", format);
    return `/api/export?${params.toString()}`;
  }

  const folderLabel =
    urlFolder === "root"
      ? "ยังไม่จัดหมวด"
      : urlFolder
      ? flatFolders.find((f) => f._id === urlFolder)?.name ?? "โฟลเดอร์"
      : "ไฟล์ทั้งหมด";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search &amp; browse</h1>
        <p className="text-sm text-[var(--color-muted)]">
          พิมพ์หลายคำได้ ระบบจะหาไฟล์ที่มีทุกคำนั้นอยู่ในชื่อไฟล์ คำอธิบาย หรือแท็ก (ไม่ต้องตรงคำเป๊ะ) —
          ลากไฟล์ไปวางบนโฟลเดอร์ทางซ้ายหรือไอคอนโฟลเดอร์ด้านล่างเพื่อย้ายเข้าไปได้เลย
        </p>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-4 sm:w-56">
          <FolderSidebar
            activeFolderId={urlFolder}
            onSelect={(folderId) => updateUrl({ folderId, page: 1 })}
            onDropFile={handleMove}
            refreshKey={foldersRefreshKey}
            onChanged={() => setFoldersRefreshKey((k) => k + 1)}
            canDelete={isAdmin}
          />
          <StoragePanel refreshKey={foldersRefreshKey} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="font-medium text-[var(--color-text)]">{folderLabel}</span>
            {data && <span>· {data.total} ไฟล์</span>}
          </div>

          {subfolders.length > 0 && (
            <FolderGrid
              folders={subfolders}
              onOpen={(folderId) => updateUrl({ folderId, page: 1 })}
              onDropFile={(fileId, folderId) => handleMove(fileId, folderId)}
            />
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="พิมพ์หลายคำ เช่น invoice ลูกค้า 2026…"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
              />
            </div>
            <select
              value={urlTag}
              onChange={(e) => updateUrl({ tag: e.target.value, page: 1 })}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
            >
              <option value="">All tags</option>
              {tagsList.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <a
                href={exportUrl("csv")}
                className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-zinc-50"
              >
                <Download size={14} /> CSV
              </a>
              <a
                href={exportUrl("json")}
                className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-zinc-50"
              >
                <Download size={14} /> JSON
              </a>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-blue-50 px-3 py-2 text-sm">
              <span className="font-medium text-[var(--color-accent)]">{selectedIds.size} เลือกแล้ว</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkTags(true)}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  <Tag size={13} /> แก้ไขแท็ก
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  ยกเลิกการเลือก
                </button>
              </div>
            </div>
          )}

          {bulkResult && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 size={16} /> อัปเดตแท็ก {bulkResult.updated} ไฟล์
              {bulkResult.skipped > 0 && ` (ข้าม ${bulkResult.skipped} ไฟล์ที่ไม่มีสิทธิ์แก้ไข)`}
            </div>
          )}

          {loading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

          {!loading && data && data.items.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted)]">
              No files match this search yet.
            </div>
          )}

          {!loading && data && data.items.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {data.items.map((f) => (
                <FileCard
                  key={f._id}
                  file={f}
                  selected={selectedIds.has(f._id)}
                  onToggleSelect={toggleSelect}
                  folders={flatFolders}
                  onDelete={handleDelete}
                  onPreview={setPreview}
                  onMove={handleMove}
                />
              ))}
            </div>
          )}

          {data && data.pages > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button
                disabled={urlPage <= 1}
                onClick={() => updateUrl({ page: urlPage - 1 })}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-[var(--color-muted)]">
                Page {data.page} of {data.pages}
              </span>
              <button
                disabled={urlPage >= data.pages}
                onClick={() => updateUrl({ page: urlPage + 1 })}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] ${
              getFileKind(preview.mimeType, preview.filename) === "pdf" ? "max-w-4xl" : "max-w-2xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <p className="truncate text-sm font-medium">{preview.filename}</p>
              <button onClick={() => setPreview(null)} className="rounded p-1 hover:bg-zinc-100" aria-label="Close preview">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-zinc-50 p-4">
              {(() => {
                const kind = getFileKind(preview.mimeType, preview.filename);
                if (kind === "image") {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${preview._id}/download?view=1`}
                      alt={preview.filename}
                      className="max-h-[60vh] max-w-full object-contain"
                    />
                  );
                }
                if (kind === "pdf") {
                  return (
                    <iframe
                      src={`/api/files/${preview._id}/download?view=1`}
                      title={preview.filename}
                      className="h-[70vh] w-full rounded border-0 bg-white"
                    />
                  );
                }
                if (kind === "cad") {
                  return (
                    <div className="flex flex-col items-center gap-2 text-[var(--color-muted)]">
                      <FileBox size={40} className="text-amber-600" />
                      <p className="text-sm">CAD files can&apos;t be previewed in the browser.</p>
                      <p className="text-xs">Download it to open in CAD software.</p>
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col items-center gap-2 text-[var(--color-muted)]">
                    <FileText size={40} />
                    <p className="text-sm">No inline preview for this file type.</p>
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3 text-sm">
              <p className="text-[var(--color-muted)]">{preview.description || "No description"}</p>
              <a
                href={`/api/files/${preview._id}/download?download=1`}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                Download
              </a>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`ลบไฟล์ "${deleteTarget.name}" ถาวรหรือไม่?`}
          danger
          confirmLabel="ลบไฟล์"
          onConfirm={confirmDeleteFile}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {showBulkTags && (
        <BulkTagDialog
          fileIds={[...selectedIds]}
          suggestions={tagsList.map((t) => t.tag)}
          onClose={() => setShowBulkTags(false)}
          onDone={(result) => {
            setShowBulkTags(false);
            setSelectedIds(new Set());
            setBulkResult(result);
            setTimeout(() => setBulkResult(null), 4000);
            fetchFiles();
            setFoldersRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-muted)]">Loading…</p>}>
      <SearchPageInner />
    </Suspense>
  );
}
