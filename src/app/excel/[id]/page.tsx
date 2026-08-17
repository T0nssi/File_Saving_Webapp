"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Download, Copy, Share2 } from "lucide-react";
import ExcelEditor, { type StructuralOp } from "@/components/ExcelEditor";
import ShareDialog from "@/components/ShareDialog";
import SaveAsDialog from "@/components/SaveAsDialog";
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
  const [masterFile, setMasterFile] = useState<FileDoc | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [revisions, setRevisions] = useState<RevisionDoc[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revisionsWarning, setRevisionsWarning] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped whenever `sheets` is replaced from the server (initial load, restore) so
  // ExcelEditor remounts and picks up the new data instead of keeping its stale internal state.
  const [sheetsVersion, setSheetsVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchFile() {
      try {
        const res = await apiFetch(`/api/files/${id}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.file) {
          setFile(data.file);
        } else {
          setLoadError(data.error ?? "File not found");
        }
      } catch (err) {
        if (!cancelled) setLoadError("Failed to load file");
      }
    }

    async function fetchSheets() {
      try {
        const res = await apiFetch(`/api/files/${id}/excel`);
        let data: { sheets?: unknown; error?: string };
        try {
          data = await res.json();
        } catch {
          // The response wasn't JSON at all — a timeout/gateway error page,
          // a crash that bypassed the route's own try/catch, etc. Surface
          // the HTTP status since that's the only signal available here;
          // without this, every such failure collapsed into the same
          // uninformative "Failed to load Excel file" regardless of cause.
          throw new Error(`Server returned an unreadable response (HTTP ${res.status})`);
        }
        if (cancelled) return;
        if (data.sheets) {
          setSheets(data.sheets as Sheet[]);
          setSheetsVersion((v) => v + 1);
        } else {
          setLoadError(data.error ?? `Failed to load sheets (HTTP ${res.status})`);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load Excel file");
      }
    }

    async function fetchRevisionsInitial() {
      try {
        const res = await apiFetch(`/api/files/${id}/revisions`);
        const data = await res.json();
        if (cancelled) return;
        if (data.revisions) {
          setRevisions(data.revisions);
          setRevisionsWarning(null);
        } else {
          setRevisionsWarning(data.error ?? "Revision history unavailable");
        }
      } catch (err) {
        if (!cancelled) setRevisionsWarning("Revision history unavailable");
      }
    }

    // Run independently so one failure doesn't clobber another's error/success state.
    Promise.all([fetchFile(), fetchSheets(), fetchRevisionsInitial()]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!file?.sourceFileId) {
      setMasterFile(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/files/${file.sourceFileId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { file: FileDoc } | null) => {
        if (!cancelled) setMasterFile(data?.file ?? null);
      })
      .catch(() => {
        if (!cancelled) setMasterFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file?.sourceFileId]);

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
    } catch (err) {
      setRevisionsWarning("Revision history unavailable");
    }
  }

  async function handleSave(newSheets: Sheet[], structuralOps: StructuralOp[]): Promise<boolean> {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${id}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: newSheets, structuralOps }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return false;
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setSheets(newSheets);
        await fetchRevisions();
        return true;
      }
    } catch (err) {
      setError("Network error — is the server running?");
      return false;
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
        const res2 = await apiFetch(`/api/files/${id}/excel`);
        const sheetsData = await res2.json();
        if (sheetsData.sheets) {
          setSheets(sheetsData.sheets);
          setSheetsVersion((v) => v + 1);
        }
        await fetchRevisions();
      }
    } catch (err) {
      setError("Network error — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  if (loadError && !file) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm text-[var(--color-danger)]">{loadError}</p>
        <Link href="/search" className="mt-3 inline-block text-sm text-[var(--color-accent)]">
          Back to search
        </Link>
      </div>
    );
  }

  if (!file || loading) {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  const sortedRevisions = [...revisions].sort((a, b) => b.versionNumber - a.versionNumber);

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
          {file.lastAccessedBy && file.lastAccessedAt && (
            <p className="text-xs text-[var(--color-muted)]">
              Last opened by {file.lastAccessedBy} on {new Date(file.lastAccessedAt).toLocaleString()}
            </p>
          )}
          {file.sourceFileId && (
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Cloned from{" "}
              {masterFile ? (
                <Link href={`/excel/${masterFile._id}`} className="text-[var(--color-accent)] hover:underline">
                  {masterFile.filename}
                </Link>
              ) : (
                "a master file that no longer exists"
              )}
            </p>
          )}
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
            onClick={() => setShowCloneDialog(true)}
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
          {file.canManageSharing && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
            >
              <Share2 size={16} /> Share
            </button>
          )}
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
        <SaveAsDialog
          fileId={id}
          defaultFilename={`${file.filename.replace(/\.xlsx?$/, "")} (copy).xlsx`}
          currentFolderId={file.folderId}
          redirectPrefix="/excel"
          onClose={() => setShowCloneDialog(false)}
        />
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
                    <button
                      onClick={() => handleRestore(rev.versionNumber)}
                      disabled={saving || unavailable}
                      title={unavailable ? "This version's file data no longer exists and can't be restored" : undefined}
                      className="ml-2 shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-blue-50 disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {sheets.length > 0 ? (
        <ExcelEditor
          key={sheetsVersion}
          fileId={id}
          filename={file.filename}
          initialSheets={sheets}
          onSave={handleSave}
          saving={saving}
          readOnly={file.myAccess !== "edit"}
        />
      ) : (
        loadError && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} /> Couldn't load the spreadsheet contents: {loadError}
          </div>
        )
      )}

      {showShare && (
        <ShareDialog fileId={id} filename={file.filename} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
