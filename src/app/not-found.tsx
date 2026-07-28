import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <p className="text-sm text-[var(--color-muted)]">The page you're looking for doesn't exist.</p>
      <Link href="/" className="mt-2 text-sm font-medium text-[var(--color-accent)]">
        Back to overview
      </Link>
    </div>
  );
}
