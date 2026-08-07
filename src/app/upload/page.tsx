"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DropZone, { relativeDir } from "@/components/DropZone";
import TagInput from "@/components/TagInput";
import { PromptModal } from "@/components/Dialog";
import { apiFetch } from "@/lib/apiFetch";
import { CheckCircle2, AlertTriangle, Loader2, FolderPlus, Search, X, Folder as FolderIcon } from "lucide-react";
import type { TagCount, FolderDoc } from "@/types";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [folders, setFolders] = useState<FolderDoc[]>([]);
  const [folderId, setFolderId] = useState<string>("root");
  const [folderQuery, setFolderQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ saved: number; rejected: { name: string; reason: string }[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ maxFileSize: number; maxFilesPerUpload: number } | null>(null);

  useEffect(() => {
    apiFetch("/api/tags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { tags: TagCount[] } | null) => setSuggestions(data?.tags.map((t) => t.tag) ?? []))
      .catch(() => {});
    // ?flat=1 returns every folder regardless of depth (no counts) — the
    // upload dropdown needs to offer nested subfolders as destinations too,
    // not just the top level.
    apiFetch("/api/folders?flat=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { folders: FolderDoc[] } | null) => setFolders(data?.folders ?? []))
      .catch(() => {});
    // Current server-side limits, read live so an env-var change on the
    // server shows up here without needing a client rebuild.
    apiFetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { maxFileSize: number; maxFilesPerUpload: number } | null) => setConfig(data))
      .catch(() => {});
  }, []);

  // Breadcrumb path per folder id, walked from the already-fetched flat list —
  // same approach as FolderSidebar's search, so a nested folder reads as
  // "Parent / Child" instead of just its own name.
  const folderPathById = useMemo(() => {
    const byId = new Map(folders.map((f) => [f._id, f]));
    const paths = new Map<string, string>();
    function pathOf(id: string): string {
      if (paths.has(id)) return paths.get(id)!;
      const f = byId.get(id);
      if (!f) return "";
      const parentPath = f.parentId ? pathOf(f.parentId) : "";
      const full = parentPath ? `${parentPath} / ${f.name}` : f.name;
      paths.set(id, full);
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

    // Reuse an existing top-level folder with the same name instead of creating
    // a duplicate — new folders from this page always land at the top level
    // (parentId: null), same as browsing straight under "root" in Search.
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

  // Auto-creates (or reuses) the folder chain for a relative directory path picked
  // via "select a folder", e.g. "Invoices/2026" under whatever destination folder is
  // currently selected — mirroring the picked folder's structure instead of dumping
  // every file flat into one place. `known` is extended in place as folders are
  // created, so files sharing a prefix within the same submit reuse the same lookup.
  async function resolveFolderId(
    dir: string,
    baseFolderId: string | null,
    known: FolderDoc[],
    cache: Map<string, string | null>
  ): Promise<string | null> {
    if (!dir) return baseFolderId;
    if (cache.has(dir)) return cache.get(dir)!;

    const idx = dir.lastIndexOf("/");
    const parentDir = idx === -1 ? "" : dir.slice(0, idx);
    const name = idx === -1 ? dir : dir.slice(idx + 1);
    const parentId = await resolveFolderId(parentDir, baseFolderId, known, cache);

    const existing = known.find(
      (f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      cache.set(dir, existing._id);
      return existing._id;
    }

    const res = await apiFetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? `Could not create folder "${name}"`);
    }
    known.push(data.folder);
    cache.set(dir, data.folder._id);
    return data.folder._id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Add at least one file before uploading.");
      return;
    }
    setError(null);
    setResult(null);
    setSubmitting(true);

    try {
      const baseFolderId = folderId === "root" ? null : folderId;
      const knownFolders = [...folders];
      const dirCache = new Map<string, string | null>();

      // Skip oversized files client-side instead of sending them over the wire
      // just to have the server reject them — same limit the server enforces,
      // read live from /api/config so it can't drift from what's actually set.
      const preRejected: { name: string; reason: string }[] = [];
      const uploadable = config
        ? files.filter((f) => {
            if (f.size > config.maxFileSize) {
              preRejected.push({ name: f.name, reason: "exceeds max file size" });
              return false;
            }
            return true;
          })
        : files;

      // Group files by their resolved destination folder — files from a plain pick/drop
      // all land in one group (baseFolderId, same as before); files carrying a relative
      // directory (from "select a folder") are grouped per auto-created subfolder.
      const groups = new Map<string, File[]>();
      for (const f of uploadable) {
        const dir = relativeDir(f);
        const targetFolderId = await resolveFolderId(dir, baseFolderId, knownFolders, dirCache);
        const key = targetFolderId ?? "root";
        const group = groups.get(key);
        if (group) group.push(f);
        else groups.set(key, [f]);
      }

      let totalSaved = 0;
      const allRejected: { name: string; reason: string }[] = [...preRejected];
      // One failing group (a folder's batch) must not abort the others —
      // each group is an independent request, so a server error or dropped
      // connection on one folder's files shouldn't stop files destined for
      // a different folder from uploading. Every failure is still recorded,
      // both inline for the user and via the server's client-error log.
      const groupErrors: string[] = [];
      for (const [key, groupFiles] of groups) {
        try {
          const formData = new FormData();
          // Metadata fields first, files last: the server now streams this
          // multipart body straight into GridFS as it arrives (see
          // api/upload/route.ts) rather than buffering it, so it needs tags/
          // description/folderId parsed before it starts processing file
          // parts — otherwise a file could finish streaming before the
          // server even knows which folder it belongs in.
          formData.append("tags", tags.join(","));
          formData.append("description", description);
          if (key !== "root") formData.append("folderId", key);
          groupFiles.forEach((f) => formData.append("files", f));

          const res = await apiFetch("/api/upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!res.ok) {
            const reason = data.error ?? "Upload failed";
            groupErrors.push(reason);
            groupFiles.forEach((f) => allRejected.push({ name: f.name, reason }));
            continue;
          }
          totalSaved += data.saved.length;
          allRejected.push(...data.rejected);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Network error";
          groupErrors.push(reason);
          groupFiles.forEach((f) => allRejected.push({ name: f.name, reason }));
        }
      }

      if (groupErrors.length > 0) {
        const message = `${groupErrors.length} of ${groups.size} folder batch(es) failed: ${groupErrors.join("; ")}`;
        setError(message);
        apiFetch("/api/logs/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Upload page: ${message}` }),
        }).catch(() => {});
      }

      setFolders(knownFolders.sort((a, b) => a.name.localeCompare(b.name)));
      setResult({ saved: totalSaved, rejected: allRejected });
      setFiles([]);
      setTags([]);
      setDescription("");
      if (totalSaved > 0) {
        const dest = folderId !== "root" ? `/search?folderId=${folderId}` : "/search?folderId=root";
        setTimeout(() => router.push(dest), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — is the server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload files</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Files are stored in MongoDB (GridFS). Add tags and a description to make them easy to find later.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <DropZone
          files={files}
          onChange={setFiles}
          maxFileSize={config?.maxFileSize}
          maxFilesPerUpload={config?.maxFilesPerUpload}
        />

        <div>
          <label htmlFor="folder-search" className="mb-1.5 block text-sm font-medium">
            โฟลเดอร์ปลายทาง
          </label>
          <p className="mb-1.5 text-xs text-[var(--color-muted)]">
            เลือกแล้ว: <span className="font-medium text-[var(--color-text)]">{selectedFolderLabel}</span>
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                id="folder-search"
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
            <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-[var(--color-border)] p-1">
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
              <option value="root">ยังไม่จัดหมวด (จัดเข้าโฟลเดอร์ทีหลังได้)</option>
              {folders.map((f) => (
                <option key={f._id} value={f._id}>
                  {folderPathById.get(f._id) || f.name}
                </option>
              ))}
            </select>
          )}

          <p className="mt-1 text-xs text-[var(--color-muted)]">
            ยังไม่แน่ใจว่าจะเก็บที่ไหน เลือก &quot;ยังไม่จัดหมวด&quot; ไว้ก่อนได้ แล้วค่อยย้ายทีหลังจากหน้า Search
          </p>
          {folderError && (
            <p className="mt-1 text-xs text-[var(--color-danger)]">{folderError}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Tags</label>
          <TagInput tags={tags} onChange={setTags} suggestions={suggestions} placeholder="e.g. invoice, 2026, client-x" />
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Press Enter or comma to add. Tags apply to all files in this batch and are used for search &amp; grouping.
          </p>
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What is this file, and why does it matter?"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-1 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} /> Saved {result.saved} file(s).
            </span>
            {result.rejected.length > 0 &&
              result.rejected.map((r, i) => (
                <span key={`${r.name}-${i}`} className="pl-6 text-xs text-amber-700">
                  Skipped {r.name}: {r.reason}
                </span>
              ))}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? "Uploading…" : "Upload files"}
        </button>
      </form>

      {showNewFolder && (
        <PromptModal
          title="ชื่อโฟลเดอร์ใหม่ (จะสร้างที่ระดับบนสุด)"
          submitLabel="สร้าง"
          onSubmit={createFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </div>
  );
}
