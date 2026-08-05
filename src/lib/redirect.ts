// The "from" query param on /login and /register is attacker-controllable
// (anyone can send someone a link like /login?from=https://evil.example),
// so it must never be used as-is for a redirect — only a same-origin
// relative path is safe. Without this, a crafted link could send someone
// to an external site right after they type their real password in.
//
// It also rejects /login or /register themselves as a destination: those
// were previously accepted (they're same-origin paths), which let the two
// pages' own no-session redirects target each other — each hop re-encoding
// the other's "from" param one layer deeper — an infinite ping-pong.
// There's never a legitimate reason to redirect "back" to the auth pages
// after authenticating, so collapsing that case to "/" closes the loop at
// its source rather than relying on every redirect site to avoid it.
export function sanitizeRedirectPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return "/";
  if (path === "/login" || path.startsWith("/login?") || path === "/register" || path.startsWith("/register?")) {
    return "/";
  }
  return path;
}
