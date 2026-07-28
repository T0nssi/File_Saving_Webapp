"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Info, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import type { LogDoc, Paginated } from "@/types";

const levelStyles: Record<string, string> = {
  info: "bg-blue-50 text-blue-700",
  warn: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

const levelIcons = { info: Info, warn: AlertTriangle, error: AlertCircle };

export default function LogsPage() {
  const [level, setLevel] = useState("");
  const [data, setData] = useState<Paginated<LogDoc> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    params.set("page", String(page));
    apiFetch(`/api/logs?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [level, page]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">History &amp; error log</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Every upload, edit, delete and export is recorded here, along with any server errors.
        </p>
      </div>

      <div className="flex gap-2">
        {["", "info", "warn", "error"].map((l) => (
          <button
            key={l || "all"}
            onClick={() => {
              setPage(1);
              setLevel(l);
            }}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              level === l
                ? "bg-[var(--color-accent)] text-white"
                : "border border-[var(--color-border)] hover:bg-zinc-50"
            }`}
          >
            {l || "all"}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

      {!loading && data && data.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted)]">
          No log entries yet.
        </div>
      )}

      {!loading && data && data.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.items.map((log) => {
            const Icon = levelIcons[log.level];
            return (
              <li
                key={log._id}
                className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
              >
                <span className={`mt-0.5 rounded-full p-1.5 ${levelStyles[log.level]}`}>
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium capitalize">{log.action}</span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[var(--color-muted)]">{log.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[var(--color-muted)]">
            Page {data.page} of {data.pages}
          </span>
          <button
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
