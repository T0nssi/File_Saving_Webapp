"use client";

import { useState } from "react";
import { AlertTriangle, Tag } from "lucide-react";
import TagInput from "@/components/TagInput";
import { apiFetch } from "@/lib/apiFetch";

interface Props {
  fileIds: string[];
  suggestions: string[];
  onClose: () => void;
  onDone: (result: { updated: number; skipped: number }) => void;
}

// Bulk "edit tags" action from the search page's selection toolbar — adds
// and/or removes tags across every selected file in one request. Files the
// requester can't edit are skipped server-side rather than failing the
// whole batch (see api/files/bulk-tags/route.ts), since a mixed selection
// of own/shared files is the normal case here.
export default function BulkTagDialog({ fileIds, suggestions, onClose, onDone }: Props) {
  const [addTags, setAddTags] = useState<string[]>([]);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (addTags.length === 0 && removeTags.length === 0) {
      setError("Add or remove at least one tag");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/files/bulk-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds, addTags, removeTags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Bulk tag update failed");
        return;
      }
      onDone({ updated: data.updated, skipped: data.skipped });
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => !saving && onClose()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-lg"
      >
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <Tag size={18} /> Edit tags
        </h2>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Applies to {fileIds.length} selected file{fileIds.length > 1 ? "s" : ""}. Files you don't have edit access to are
          skipped.
        </p>

        <label className="mb-1.5 block text-sm font-medium">Add tags</label>
        <TagInput tags={addTags} onChange={setAddTags} suggestions={suggestions} placeholder="e.g. archived, 2026" />

        <label className="mb-1.5 mt-4 block text-sm font-medium">Remove tags</label>
        <TagInput tags={removeTags} onChange={setRemoveTags} suggestions={suggestions} placeholder="Tags to strip out" />

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {saving ? "Applying..." : "Apply"}
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
  );
}
