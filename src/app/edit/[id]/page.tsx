"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, CheckCircle2, AlertTriangle, Share2 } from "lucide-react";
import TagInput from "@/components/TagInput";
import ShareDialog from "@/components/ShareDialog";
import { apiFetch } from "@/lib/apiFetch";
import type { FileDoc, TagCount } from "@/types";

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [file, setFile] = useState<FileDoc | null>(null);
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

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

  const isImage = file.mimeType.startsWith("image/");
  const readOnly = file.myAccess !== "edit";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/search" className="flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} /> Back to search
      </Link>

      <div className="flex items-center gap-4">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${file._id}/download`}
            alt={file.filename}
            className="h-20 w-20 rounded-lg object-cover"
          />
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

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle size={16} /> You only have view access to this file — changes can't be saved.
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
