"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DropZone from "@/components/DropZone";
import TagInput from "@/components/TagInput";
import { PromptModal } from "@/components/Dialog";
import { apiFetch } from "@/lib/apiFetch";
import { CheckCircle2, AlertTriangle, Loader2, FolderPlus } from "lucide-react";
import type { TagCount, FolderDoc } from "@/types";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [folders, setFolders] = useState<FolderDoc[]>([]);
  const [folderId, setFolderId] = useState<string>("root");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ saved: number; rejected: { name: string; reason: string }[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

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
  }, []);

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
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      formData.append("tags", tags.join(","));
      formData.append("description", description);
      if (folderId !== "root") formData.append("folderId", folderId);

      const res = await apiFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        setResult({ saved: data.saved.length, rejected: data.rejected });
        setFiles([]);
        setTags([]);
        setDescription("");
        if (data.saved.length > 0) {
          const dest = folderId !== "root" ? `/search?folderId=${folderId}` : "/search?folderId=root";
          setTimeout(() => router.push(dest), 1200);
        }
      }
    } catch {
      setError("Network error — is the server running?");
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
        <DropZone files={files} onChange={setFiles} />

        <div>
          <label htmlFor="folder" className="mb-1.5 block text-sm font-medium">
            โฟลเดอร์ปลายทาง
          </label>
          <div className="flex gap-2">
            <select
              id="folder"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            >
              <option value="root">ยังไม่จัดหมวด (จัดเข้าโฟลเดอร์ทีหลังได้)</option>
              {folders.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name}
                </option>
              ))}
            </select>
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
              result.rejected.map((r) => (
                <span key={r.name} className="pl-6 text-xs text-amber-700">
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
