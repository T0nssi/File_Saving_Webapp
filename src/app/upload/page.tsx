"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DropZone, { relativeDir } from "@/components/DropZone";
import TagInput from "@/components/TagInput";
import { PromptModal } from "@/components/Dialog";
import { apiFetch } from "@/lib/apiFetch";
import { CheckCircle2, AlertTriangle, Loader2, FolderPlus, Search, X, Folder as FolderIcon, Copy } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { TagCount, FolderDoc } from "@/types";

interface RejectedFile {
  name: string;
  reason: string;
}

interface DuplicateMatch {
  _id: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

type DupResolution = "version" | "keep" | "skip";

interface DupItem {
  file: File;
  groupKey: string;
  existing: DuplicateMatch;
  resolution: DupResolution;
}

interface PendingUpload {
  groups: Map<string, File[]>;
  knownFolders: FolderDoc[];
  preRejected: RejectedFile[];
}

// "report.pdf" -> "report (2).pdf" — good enough for the "keep both" choice;
// doesn't re-check against every other existing name (the same tradeoff
// accepted when this feature was scoped).
function suffixName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${base} (2)${ext}`;
}

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
  const [result, setResult] = useState<{ saved: number; versioned: number; rejected: RejectedFile[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ maxFileSize: number; maxFilesPerUpload: number } | null>(null);
  const [dupPrompt, setDupPrompt] = useState<DupItem[] | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

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
      const preRejected: RejectedFile[] = [];
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

      // Check each destination folder for a name already sitting there
      // (scoped to what this user can see — see check-duplicates/route.ts)
      // before actually uploading anything, so a collision can be resolved
      // instead of silently producing two unrelated files with the same name.
      setCheckingDuplicates(true);
      const dupChecks = await Promise.all(
        [...groups.entries()].map(async ([key, groupFiles]) => {
          try {
            const res = await apiFetch("/api/files/check-duplicates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ folderId: key === "root" ? null : key, names: groupFiles.map((f) => f.name) }),
            });
            if (!res.ok) return { key, duplicates: [] as { name: string; file: DuplicateMatch }[] };
            const data = await res.json();
            return { key, duplicates: (data.duplicates ?? []) as { name: string; file: DuplicateMatch }[] };
          } catch {
            // Best-effort: a failed check just means duplicates go undetected
            // this time, not that the upload itself should be blocked.
            return { key, duplicates: [] as { name: string; file: DuplicateMatch }[] };
          }
        })
      );
      setCheckingDuplicates(false);

      const dupItems: DupItem[] = [];
      for (const { key, duplicates } of dupChecks) {
        const groupFiles = groups.get(key)!;
        for (const dup of duplicates) {
          const file = groupFiles.find((f) => f.name === dup.name);
          if (file) dupItems.push({ file, groupKey: key, existing: dup.file, resolution: "keep" });
        }
      }

      if (dupItems.length > 0) {
        setPendingUpload({ groups, knownFolders, preRejected });
        setDupPrompt(dupItems);
        setSubmitting(false);
        return;
      }

      await performUpload(groups, knownFolders, preRejected, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — is the server running?");
      setSubmitting(false);
      setCheckingDuplicates(false);
    }
  }

  async function performUpload(
    groups: Map<string, File[]>,
    knownFolders: FolderDoc[],
    preRejected: RejectedFile[],
    resolutions: DupItem[]
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const skipSet = new Set(resolutions.filter((r) => r.resolution === "skip").map((r) => r.file));
      const renameMap = new Map(resolutions.filter((r) => r.resolution === "keep").map((r) => [r.file, suffixName(r.file.name)]));
      const versionMap = new Map(resolutions.filter((r) => r.resolution === "version").map((r) => [r.file, r.existing._id]));

      let totalSaved = 0;
      let totalVersioned = 0;
      const allRejected: RejectedFile[] = [...preRejected];
      // One failing group (a folder's batch) must not abort the others —
      // each group is an independent request, so a server error or dropped
      // connection on one folder's files shouldn't stop files destined for
      // a different folder from uploading. Every failure is still recorded,
      // both inline for the user and via the server's client-error log.
      const groupErrors: string[] = [];
      for (const [key, groupFiles] of groups) {
        const activeFiles = groupFiles.filter((f) => !skipSet.has(f));
        if (activeFiles.length === 0) continue;

        try {
          const formData = new FormData();
          // Metadata fields first, files last: the server now streams this
          // multipart body straight into GridFS as it arrives (see
          // api/upload/route.ts) rather than buffering it, so it needs tags/
          // description/folderId/versionTargets parsed before it starts
          // processing file parts — otherwise a file could finish streaming
          // before the server even knows where it belongs.
          formData.append("tags", tags.join(","));
          formData.append("description", description);
          if (key !== "root") formData.append("folderId", key);

          // Build the version-target map and the (possibly renamed) File
          // objects before appending anything, so the "versionTargets" field
          // always lands in the FormData ahead of every "files" entry — the
          // streaming parser only knows where a file belongs by the fields
          // it's already seen, same reasoning as tags/description/folderId
          // above.
          const versionTargets: Record<string, string> = {};
          const uploadFiles: File[] = [];
          for (const f of activeFiles) {
            const targetId = versionMap.get(f);
            // Renaming only ever applies to "keep both"; a file being
            // uploaded as a new version keeps its original name, since
            // that's exactly the name the target file already has.
            const uploadFile = renameMap.has(f) ? new File([f], renameMap.get(f)!, { type: f.type }) : f;
            if (targetId) versionTargets[uploadFile.name] = targetId;
            uploadFiles.push(uploadFile);
          }
          if (Object.keys(versionTargets).length > 0) {
            formData.append("versionTargets", JSON.stringify(versionTargets));
          }
          uploadFiles.forEach((f) => formData.append("files", f));

          const res = await apiFetch("/api/upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!res.ok) {
            const reason = data.error ?? "Upload failed";
            groupErrors.push(reason);
            activeFiles.forEach((f) => allRejected.push({ name: f.name, reason }));
            continue;
          }
          totalSaved += data.saved.length;
          totalVersioned += data.versioned ?? 0;
          allRejected.push(...data.rejected);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Network error";
          groupErrors.push(reason);
          activeFiles.forEach((f) => allRejected.push({ name: f.name, reason }));
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
      setResult({ saved: totalSaved, versioned: totalVersioned, rejected: allRejected });
      setFiles([]);
      setTags([]);
      setDescription("");
      setDupPrompt(null);
      setPendingUpload(null);
      if (totalSaved + totalVersioned > 0) {
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
              {result.versioned > 0 && ` ${result.versioned} uploaded as a new version of an existing file.`}
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
          disabled={submitting || checkingDuplicates}
          className="flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {(submitting || checkingDuplicates) && <Loader2 size={16} className="animate-spin" />}
          {checkingDuplicates ? "Checking for duplicates…" : submitting ? "Uploading…" : "Upload files"}
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

      {dupPrompt && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Copy size={18} className="text-amber-600" /> พบไฟล์ชื่อซ้ำ
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                พบ {dupPrompt.length} ไฟล์ที่ชื่อซ้ำกับไฟล์ในโฟลเดอร์ปลายทาง เลือกวิธีจัดการแต่ละไฟล์ก่อนอัปโหลด
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="flex flex-col gap-3">
                {dupPrompt.map((item, i) => {
                  const path = item.groupKey === "root" ? "ยังไม่จัดหมวด" : folderPathById.get(item.groupKey) ?? item.groupKey;
                  return (
                    <div key={`${item.file.name}-${i}`} className="rounded-md border border-[var(--color-border)] p-3">
                      <p className="truncate text-sm font-medium">{item.file.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                        ไฟล์เดิมอยู่ที่: <span className="font-medium text-[var(--color-text)]">{path}</span>
                        {" · "}อัปโหลดเมื่อ {new Date(item.existing.uploadedAt).toLocaleDateString()}
                        {" · "}
                        {formatBytes(item.existing.size)}
                      </p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {(
                          [
                            ["version", "อัปโหลดเป็นเวอร์ชันใหม่ของไฟล์เดิม (เก็บไฟล์เก่าไว้ในประวัติ)"],
                            ["keep", "เก็บทั้งสองไฟล์ (จะเปลี่ยนชื่อไฟล์ใหม่อัตโนมัติ)"],
                            ["skip", "ข้ามไฟล์นี้ (ไม่อัปโหลด)"],
                          ] as [DupResolution, string][]
                        ).map(([opt, label]) => (
                          <label key={opt} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`dup-${i}`}
                              checked={item.resolution === opt}
                              onChange={() =>
                                setDupPrompt((prev) => prev!.map((it, idx) => (idx === i ? { ...it, resolution: opt } : it)))
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setDupPrompt(null);
                  setPendingUpload(null);
                }}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  const resolutions = dupPrompt;
                  const pending = pendingUpload;
                  performUpload(pending.groups, pending.knownFolders, pending.preRejected, resolutions);
                }}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                ยืนยันและอัปโหลด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
