"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Vault, Upload, Search, ScrollText, LogOut, ShieldOff, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

const links = [
  { href: "/", label: "Overview", icon: Vault },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/search", label: "Search", icon: Search },
  { href: "/logs", label: "History", icon: ScrollText },
];

const SESSION_CHECK_INTERVAL_MS = 20_000;

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "member" | null>(null);

  useEffect(() => {
    function checkSession() {
      // Deliberately a plain fetch, not apiFetch: a 401 here just means "not
      // logged in yet", which is expected on /register during the no-user
      // bootstrap flow — that must not trigger apiFetch's auto-redirect to
      // /login, or the two pages bounce each other back and forth forever
      // (each hop re-encoding the other's "from" param into the URL).
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : { username: null, role: null }))
        .then((d: { username: string | null; role: "admin" | "member" | null }) => {
          setUsername(d.username);
          setRole(d.role);
        })
        .catch(() => {
          setUsername(null);
          setRole(null);
        });
    }

    checkSession();

    // Most pages only find out a session died the next time they call an
    // API (e.g. saving an edit). This heartbeat catches it even on pages
    // that otherwise wouldn't make another request for a while — clearing
    // cookies/storage while idle on a page is what originally slipped
    // through here.
    const interval = setInterval(() => {
      if (!document.hidden) checkSession();
    }, SESSION_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", checkSession);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, [pathname]);

  // Hidden on the login screen, and hidden until we've confirmed a session
  // exists — this also naturally hides it on /register during the
  // no-session bootstrap flow, while still showing it there for an already
  // signed-in user adding a teammate.
  if (pathname === "/login" || !username) return null;

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleLogoutAll() {
    if (!confirm("ออกจากระบบทุกอุปกรณ์ที่เคยล็อกอินไว้ (รวมเครื่องนี้ด้วย)?")) return;
    await apiFetch("/api/auth/logout-all", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Vault size={20} className="text-[var(--color-accent)]" />
          File Vault
        </Link>
        <nav className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-blue-50 text-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
          {role === "admin" && (
            <Link
              href="/register"
              aria-label="เพิ่มผู้ใช้"
              className="ml-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-text)]"
            >
              <UserPlus size={16} />
            </Link>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <span className="px-1 text-sm text-[var(--color-muted)]">
            {username}
            {role === "admin" && <span className="ml-1 text-[10px] uppercase text-[var(--color-accent)]">admin</span>}
          </span>
          <button
            type="button"
            onClick={handleLogoutAll}
            aria-label="ออกจากระบบทุกอุปกรณ์"
            title="ออกจากระบบทุกอุปกรณ์"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-danger)]"
          >
            <ShieldOff size={16} />
          </button>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-danger)]"
          >
            <LogOut size={16} />
          </button>
        </nav>
      </div>
    </header>
  );
}
