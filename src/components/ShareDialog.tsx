"use client";

import { useEffect, useState } from "react";
import { X, Share2, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import type { ResolvedShare, SharePermission } from "@/types";

interface Props {
  fileId: string;
  filename: string;
  onClose: () => void;
}

interface UserOption {
  _id: string;
  username: string;
}

export default function ShareDialog({ fileId, filename, onClose }: Props) {
  const [shares, setShares] = useState<ResolvedShare[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [submitting, setSubmitting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch(`/api/files/${fileId}/shares`).then((r) => (r.ok ? r.json() : Promise.reject(r))),
      apiFetch(`/api/users`).then((r) => (r.ok ? r.json() : Promise.reject(r))),
    ])
      .then(([sharesData, usersData]: [{ shares: ResolvedShare[] }, { users: UserOption[] }]) => {
        if (cancelled) return;
        setShares(sharesData.shares);
        setUsers(usersData.users);
      })
      .catch(async (res) => {
        if (cancelled) return;
        const data = res instanceof Response ? await res.json().catch(() => null) : null;
        setError(data?.error ?? "Could not load sharing settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const sharedUserIds = new Set(shares.map((s) => s.userId));
  const availableUsers = users.filter((u) => !sharedUserIds.has(u._id));

  async function handleAddShare(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUsername) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${fileId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: selectedUsername, permission }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not share file");
      } else {
        setShares((prev) => [...prev.filter((s) => s.userId !== data.share.userId), { ...data.share, sharedAt: new Date().toISOString() }]);
        setSelectedUsername("");
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingUserId(userId);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${fileId}/shares/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not remove share");
      } else {
        setShares((prev) => prev.filter((s) => s.userId !== userId));
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setRemovingUserId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Share2 size={18} /> Share
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]" title={filename}>
              {filename}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--color-muted)] hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : (
          <>
            <form onSubmit={handleAddShare} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <select
                  value={selectedUsername}
                  onChange={(e) => setSelectedUsername(e.target.value)}
                  className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                >
                  <option value="">Choose a user…</option>
                  {availableUsers.map((u) => (
                    <option key={u._id} value={u.username}>
                      {u.username}
                    </option>
                  ))}
                </select>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as SharePermission)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                >
                  <option value="view">Can view</option>
                  <option value="edit">Can edit</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={!selectedUsername || submitting}
                className="flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />} Share
              </button>
              {availableUsers.length === 0 && users.length > 0 && (
                <p className="text-xs text-[var(--color-muted)]">Already shared with everyone else.</p>
              )}
              {users.length === 0 && (
                <p className="text-xs text-[var(--color-muted)]">No other users exist yet to share with.</p>
              )}
            </form>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Shared with {shares.length > 0 ? `(${shares.length})` : ""}
              </p>
              {shares.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">Not shared with anyone yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {shares.map((s) => (
                    <li
                      key={s.userId}
                      className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"
                    >
                      <span className="truncate">{s.username}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-[var(--color-muted)]">
                          {s.permission === "edit" ? "Can edit" : "Can view"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${s.username}`}
                          disabled={removingUserId === s.userId}
                          onClick={() => handleRemove(s.userId)}
                          className="rounded p-1 text-[var(--color-muted)] hover:bg-red-50 hover:text-[var(--color-danger)] disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
