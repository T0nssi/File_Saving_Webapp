"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Download, Copy } from "lucide-react";
import ExcelEditor from "@/components/ExcelEditor";
import { apiFetch } from "@/lib/apiFetch";
import type { FileDoc, RevisionDoc } from "@/types";

interface Sheet {
  name: string;
  data: string[][];
}

export default function ExcelEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [file, setFile] = useState<FileDoc | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [revisions, setRevisions] = useState<RevisionDoc[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneFilename, setCloneFilename] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFile();
    fetchSheets();
    fetchRevisions();
  }, [id]);

  async function fetchFile() {
    try {
      const res = await apiFetch(`/api/files/${id}`);
      const data = await res.json();
      if (data.file) {
        setFile(data.file);
      } else {
        setError(data.error ?? "File not found");
      }
    } catch (err) {
      setError("Failed to load file");
    }
  }

  async function fetchSheets() {
    try {
      const res = await apiFetch(`/api/files/${id}/excel`);
      const data = await res.json();
      if (data.sheets) {
        setSheets(data.sheets);
      } else {
        setError(data.error ?? "Failed to load sheets");
      }
    } catch (err) {
      setError("Failed to load Excel file");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRevisions() {
    try {
      const res = await apiFetch(`/api/files/${id}/revisions`);
      const data = await res.json();
      if (data.revisions) {
        setRevisions(data.revisions);
      }
    } catch (err) {
      console.error("Failed to load revisions");
    }
  }

  async function handleSave(newSheets: Sheet[]) {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${id}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: newSheets }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setSheets(newSheets);
        await fetchRevisions();
      }
    } catch (err) {
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
        await fetchSheets();
        await fetchRevisions();
      }
    } catch (err) {
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
        router.push(`/excel/${data.file._id}`);
      }
    } catch (err) {
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

  if (!file || loading) {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <Link href="/search" className="flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} /> Back to search
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{file.filename}</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {(file.size / 1024).toFixed(1)} KB · Last modified {new Date(file.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="flex gap-2">
          <a
            href={`/api/files/${id}/download`}
            download
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
          >
            <Download size={16} /> Download
          </a>
          <button
            onClick={() => {
              setCloneFilename(`${file.filename.replace(/\.xlsx?$/, "")} (copy).xlsx`);
              setShowCloneDialog(true);
            }}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
          >
            <Copy size={16} /> Save As
          </button>
          <button
            onClick={() => setShowRevisions(!showRevisions)}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
          >
            <Clock size={16} /> History
          </button>
        </div>
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
          {revisions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No revisions yet</p>
          ) : (
            <div className="space-y-2">
              {revisions.map((rev) => (
                <div
                  key={rev._id}
                  className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm"
                >
                  <div className="flex-1">
                    <p className="font-medium">Version {rev.versionNumber}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {rev.changedBy} · {new Date(rev.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--color-muted)]">{(rev.size / 1024).toFixed(1)} KB</span>
                  <button
                    onClick={() => handleRestore(rev.versionNumber)}
                    className="ml-2 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-blue-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sheets.length > 0 && (
        <ExcelEditor
          fileId={id}
          filename={file.filename}
          initialSheets={sheets}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}
