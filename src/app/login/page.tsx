"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Vault, User, Lock, Loader2, AlertTriangle } from "lucide-react";
import { sanitizeRedirectPath } from "@/lib/redirect";

function LoginForm() {
  const searchParams = useSearchParams();
  const from = sanitizeRedirectPath(searchParams.get("from") ?? "/");

  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/register")
      .then((r) => r.json())
      .then((d: { hasUsers: boolean }) => {
        if (!d.hasUsers) {
          window.location.href = `/register?from=${encodeURIComponent(from)}`;
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        setSubmitting(false);
        return;
      }
      // Full navigation (not router.push) so the middleware re-evaluates
      // the now-authenticated request and every server component refetches.
      window.location.href = from;
    } catch {
      setError("Network error — is the server running?");
      setSubmitting(false);
    }
  }

  if (checking) return null;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Vault size={28} className="text-[var(--color-accent)]" />
        <h1 className="text-xl font-semibold tracking-tight">File Vault</h1>
        <p className="text-sm text-[var(--color-muted)]">เข้าสู่ระบบเพื่อใช้งาน</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <div className="relative">
          <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ชื่อผู้ใช้"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>
        <div className="relative">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="รหัสผ่าน"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>

      <p className="text-xs text-[var(--color-muted)]">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-medium text-[var(--color-accent)]">
          สร้างผู้ใช้ใหม่
        </Link>{" "}
        (ต้องเข้าสู่ระบบก่อนจึงจะเพิ่มผู้ใช้ได้)
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
