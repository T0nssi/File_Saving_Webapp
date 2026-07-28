"use client";

import { useState } from "react";

interface PromptModalProps {
  title: string;
  defaultValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** In-app replacement for window.prompt() — some embedding browsers (e.g.
 * webviews) don't implement it at all, so this can't rely on it. */
export function PromptModal({ title, defaultValue = "", submitLabel = "ตกลง", onSubmit, onCancel }: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
      >
        <p className="text-sm font-medium">{title}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app replacement for window.confirm() — same reasoning as PromptModal. */
export function ConfirmModal({ title, danger, confirmLabel = "ยืนยัน", onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
      >
        <p className="text-sm">{title}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
              danger
                ? "bg-[var(--color-danger)] hover:bg-red-700"
                : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
