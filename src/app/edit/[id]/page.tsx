"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertTriangle,
  Share2,
  FileText,
  FileBox,
  Download,
  Copy,
  Clock,
  Upload,
} from "lucide-react";
import TagInput from "@/components/TagInput";
import ShareDialog from "@/components/ShareDialog";
import { apiFetch } from "@/lib/apiFetch";
import { getFileKind } from "@/lib/fileKind";
import type { FileDoc, RevisionDoc, TagCount } from "@/types";

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<FileDoc | null>(null);
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

  const [revisions, setRevisions] = useState<RevisionDoc[]>([]);
  const [revisionsWarning, setRevisionsWarning] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneFilename, setCloneFilename] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);

  useEffect(() => {
    apiFetch(`/api/files/${id}`)
      .then((r) => r.json())
      .then((d: { file?: FileDoc; error?: string }) => {
        if (d.file) {
          setFile(d.file);
          setFilename(d.file.filename);
          setDescription(d.file.description);
          setTags(d.file.tags);
        } else {
          setError(d.error ?? "File not found");
        }
      });
    apiFetch("/api/tags")
      .then((r) => r.json())
      .then((d: { tags: TagCount[] }) => setSuggestions(d.tags.map((t) => t.tag)))
      .catch(() => {});
  }, [id]);

  async function fetchRevisions() {
    try {
      const res = await apiFetch(`/api/files/${id}/revisions`);
      const data = await res.json();
      if (data.revisions) {
        setRevisions(data.revisions);
        setRevisionsWarning(null);
      } else {
        setRevisionsWarning(data.error ?? "Revision history unavailable");
      }
    } catch {
      setRevisionsWarning("Revision history unavailable");
    }
  }

  const kind = file ? getFileKind(file.mimeType, file.filename) : "other";

  // Revisions aren't image-specific — a file of any type can gain one via
  // the duplicate-name-on-upload "new version" resolution, not just images
  // replaced through the button below — so history is always fetched, the
  // same as the Excel editor page does.
  useEffect(() => {
    fetchRevisions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, description, tags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Update failed");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  async function handleClone() {
    if (!cloneFilename.trim()) {
      setError("Filename cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newFilename: cloneFilename.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Clone failed");
      } else {
        router.push(`/edit/${data.file._id}`);
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(versionNumber: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${id}/revisions/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Restore failed");
      } else {
        await refetchFile();
        setImgVersion((v) => v + 1);
        await fetchRevisions();
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  async function refetchFile() {
    const res = await apiFetch(`/api/files/${id}`);
    const data: { file?: FileDoc } = await res.json();
    if (data.file) {
      setFile(data.file);
      setFilename(data.file.filename);
    }
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;

    setReplacing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", picked);
      const res = await apiFetch(`/api/files/${id}/replace`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Replace failed");
      } else {
        await refetchFile();
        setImgVersion((v) => v + 1);
        await fetchRevisions();
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setReplacing(false);
    }
  }

  if (error && !file) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm text-[var(--color-danger)]">{error}</p>
        <Link href="/search" className="mt-3 inline-block text-sm text-[var(--color-accent)]">
          Back to search
        </Link>
      </div>
    );
  }

  if (!file) return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;

  const readOnly = file.myAccess !== "edit";
  const sortedRevisions = [...revisions].sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/search" className="flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} /> Back to search
      </Link>

      <div className="flex items-center gap-4">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={imgVersion}
            src={`/api/files/${file._id}/download?v=${imgVersion}`}
            alt={file.filename}
            className="h-20 w-20 rounded-lg object-cover"
          />
        ) : kind === "pdf" ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-red-50">
            <FileText size={28} className="text-red-500" />
          </div>
        ) : kind === "cad" ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-amber-50">
            <FileBox size={28} className="text-amber-600" />
          </div>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-zinc-100 text-xs text-[var(--color-muted)]">
            {file.mimeType.split("/")[1]?.toUpperCase() ?? "FILE"}
          </div>
        )}
        <div className="flex flex-1 items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Edit file</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {(file.size / 1024).toFixed(1)} KB · uploaded {new Date(file.uploadedAt).toLocaleString()}
            </p>
            {file.lastAccessedBy && file.lastAccessedAt && (
              <p className="text-xs text-[var(--color-muted)]">
                Last opened by {file.lastAccessedBy} on {new Date(file.lastAccessedAt).toLocaleString()}
              </p>
            )}
          </div>
          {file.canManageSharing && (
            <button
              type="button"
              onClick={() => setShowShare(true)}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
            >
              <Share2 size={16} /> Share
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/files/${id}/download`}
          download
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
        >
          <Download size={16} /> Download
        </a>
        <button
          type="button"
          onClick={() => {
            const dot = file.filename.lastIndexOf(".");
            const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
            const ext = dot > 0 ? file.filename.slice(dot) : "";
            setCloneFilename(`${base} (copy)${ext}`);
            setShowCloneDialog(true);
          }}
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
        >
          <Copy size={16} /> Save As
        </button>
        <button
          type="button"
          onClick={() => setShowRevisions(!showRevisions)}
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
        >
          <Clock size={16} /> History
        </button>
        {kind === "image" && (
          <>
            {!readOnly && (
              <>
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleReplaceFile}
                />
                <button
                  type="button"
                  disabled={replacing}
                  onClick={() => replaceInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                >
                  <Upload size={16} /> {replacing ? "Uploading…" : "Replace image"}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle size={16} /> You only have view access to this file — changes can't be saved.
        </div>
      )}

      {showCloneDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-96 rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Save File As</h2>
            <input
              type="text"
              value={cloneFilename}
              onChange={(e) => setCloneFilename(e.target.value)}
              placeholder="New filename"
              className="mb-4 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleClone();
                if (e.key === "Escape") setShowCloneDialog(false);
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleClone}
                disabled={saving}
                className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create Copy"}
              </button>
              <button
                onClick={() => setShowCloneDialog(false)}
                className="flex-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRevisions && (
        <div className="rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4">
          <h2 className="mb-3 font-semibold">Revision History</h2>
          {revisionsWarning && (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={14} /> {revisionsWarning}
            </div>
          )}
          {sortedRevisions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No revisions yet</p>
          ) : (
            <div className="space-y-2">
              {sortedRevisions.map((rev) => {
                const unavailable = rev.fileAvailable === false;
                return (
                  <div
                    key={rev._id}
                    className={`flex items-start justify-between rounded-md bg-white px-3 py-2 text-sm ${unavailable ? "opacity-60" : ""}`}
                  >
                    <div className="flex-1">
                      <p className="font-medium">
                        Version {rev.versionNumber}
                        {unavailable && (
                          <span className="ml-2 text-xs font-normal text-[var(--color-danger)]">
                            unavailable — file data lost
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {rev.changedBy} · {new Date(rev.createdAt).toLocaleString()}
                      </p>
                      {rev.changesSummary && (
                        <p className="mt-1 text-xs text-[var(--color-text)]">{rev.changesSummary}</p>
                      )}
                    </div>
                    <span className="ml-2 shrink-0 text-xs text-[var(--color-muted)]">{(rev.size / 1024).toFixed(1)} KB</span>
                    {!readOnly && (
                      <button
                        onClick={() => handleRestore(rev.versionNumber)}
                        disabled={saving || unavailable}
                        title={unavailable ? "This version's file data no longer exists and can't be restored" : undefined}
                        className="ml-2 shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-blue-50 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Filename</label>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            readOnly={readOnly}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)] read-only:bg-zinc-50"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Tags</label>
          <TagInput tags={tags} onChange={readOnly ? () => {} : setTags} suggestions={suggestions} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={readOnly}
            rows={4}
            maxLength={2000}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)] read-only:bg-zinc-50"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 size={16} /> Saved.
          </div>
        )}

        <div className="flex gap-3">
          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              <Save size={16} /> {saving ? "Saving…" : "Save changes"}
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/search")}
            className="rounded-md border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium hover:bg-zinc-50"
          >
            {readOnly ? "Back" : "Cancel"}
          </button>
        </div>
      </form>

      {showShare && (
        <ShareDialog fileId={id} filename={file.filename} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
