import type { NextConfig } from "next";

// Safe-coding defaults: strict security headers, no powered-by leakage,
// and an explicit body size allowance for file uploads.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN, not DENY: DENY blocks framing outright, including by
          // this app's own pages — which breaks the PDF preview modal's
          // <iframe src="/api/files/[id]/download"> (search/page.tsx). The
          // actual threat X-Frame-Options guards against is a third-party
          // site framing us for clickjacking; SAMEORIGIN fully blocks that
          // while still permitting the same-origin iframe we rely on.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
