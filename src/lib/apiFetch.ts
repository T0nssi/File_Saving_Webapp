"use client";

// A 401 from any API route means "not logged in (or session revoked)" —
// without this wrapper, every page that calls fetch() directly has to
// remember to check res.ok and redirect itself, and several didn't (that
// was the bug: a 401 body got treated as real data, or crashed into the
// generic error boundary, instead of sending the user back to /login).
// Centralizing it here means one page can't forget.
//
// The login/register endpoints are excluded: they return 401 for "wrong
// password", which is a normal in-place error message, not a sign the
// person needs to be redirected to the page they're already on.
const AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT = ["/api/auth/login", "/api/auth/register"];

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);

  if (res.status === 401 && !AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT.some((p) => input.startsWith(p))) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const from = window.location.pathname + window.location.search;
      window.location.href = `/login?from=${encodeURIComponent(from)}`;
    }
  }

  return res;
}
