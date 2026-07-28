"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UserPlus, User, Lock, Loader2, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

// Same reasoning as login/page.tsx: "from" comes from the URL and is
// attacker-controllable, so only a same-origin relative path may be used.
function sanitizeRedirectPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return "/";
  return path;
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const from = sanitizeRedirectPath(searchParams.get("from") ?? "/");

  const [isBootstrap, setIsBootstrap] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/register").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { role: null })),
    ]).then(([bootstrapData, meData]: [{ hasUsers: boolean }, { role: string | null }]) => {
      setIsBootstrap(!bootstrapData.hasUsers);
      setIsAdmin(meData.role === "admin");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "สร้างผู้ใช้ไม่สำเร็จ");
        setSubmitting(false);
        return;
      }
      if (data.bootstrap) {
        // Auto-logged in as the account we just created.
        window.location.href = from;
        return;
      }
      setCreated(data.username);
      setUsername("");
      setPassword("");
      setConfirm("");
      setSubmitting(false);
    } catch {
      setError("Network error — is the server running?");
      setSubmitting(false);
    }
  }

  if (isBootstrap === null) return null;

  if (!isBootstrap && !isAdmin) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <ShieldAlert size={28} className="text-[var(--color-muted)]" />
        <h1 className="text-lg font-semibold">ต้องเป็นแอดมิน</h1>
        <p className="text-sm text-[var(--color-muted)]">
          เฉพาะแอดมินเท่านั้นที่เพิ่มผู้ใช้ใหม่ได้ ถ้าต้องการบัญชีเพิ่ม ให้ติดต่อแอดมินของทีมนี้
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <UserPlus size={28} className="text-[var(--color-accent)]" />
        <h1 className="text-xl font-semibold tracking-tight">
          {isBootstrap ? "สร้างบัญชีแรก" : "เพิ่มผู้ใช้ใหม่"}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          {isBootstrap
            ? "ยังไม่มีบัญชีในระบบ — สร้างบัญชีแรกเพื่อเริ่มใช้งาน"
            : "เพิ่มบัญชีให้เพื่อนร่วมทีมใช้เข้าคลังไฟล์นี้"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <div className="relative">
          <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ชื่อผู้ใช้ (a-z, 0-9, _ . -)"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>
        <div className="relative">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>
        <div className="relative">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="ยืนยันรหัสผ่าน"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {created && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 size={14} /> สร้างผู้ใช้ &quot;{created}&quot; แล้ว
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password || !confirm}
          className="flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? "กำลังสร้าง…" : isBootstrap ? "สร้างบัญชีและเข้าสู่ระบบ" : "สร้างผู้ใช้"}
        </button>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
