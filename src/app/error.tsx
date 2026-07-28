"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort client-side error report to the server log.
    fetch("/api/logs/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <AlertTriangle size={28} className="text-[var(--color-danger)]" />
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-[var(--color-muted)]">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={reset}
        className="mt-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
      >
        Try again
      </button>
    </div>
  );
}
