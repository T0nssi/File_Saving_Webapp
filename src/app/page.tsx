import Link from "next/link";
import { Upload, Search, ScrollText, FileStack, Tags, FolderTree, HardDrive } from "lucide-react";
import { dbConnect } from "@/lib/mongodb";
import FileModel from "@/models/File";
import FolderModel from "@/models/Folder";
import Log from "@/models/Log";
import { formatBytes } from "@/lib/format";
import type { IFile } from "@/models/File";

// This page reads live data from MongoDB on every request — never prerender
// it statically at build time (there may be no DB reachable at build time,
// and the counts would go stale immediately anyway).
export const dynamic = "force-dynamic";

async function getStats() {
  await dbConnect();
  const [fileCount, tagAgg, folderCount, errorCount, recent, sizeAgg] = await Promise.all([
    FileModel.countDocuments(),
    FileModel.aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags" } }]),
    FolderModel.countDocuments(),
    Log.countDocuments({ level: "error" }),
    FileModel.find().sort({ uploadedAt: -1 }).limit(5).lean(),
    FileModel.aggregate([{ $group: { _id: null, totalBytes: { $sum: "$size" } } }]),
  ]);
  return {
    fileCount,
    tagCount: tagAgg.length,
    folderCount,
    errorCount,
    recent,
    totalBytes: sizeAgg[0]?.totalBytes ?? 0,
  };
}

export default async function HomePage() {
  const { fileCount, tagCount, folderCount, errorCount, recent, totalBytes } = await getStats();

  const cards = [
    { label: "Files stored", value: fileCount, icon: FileStack },
    { label: "Storage used", value: formatBytes(totalBytes), icon: HardDrive },
    { label: "Folders", value: folderCount, icon: FolderTree },
    { label: "Unique tags", value: tagCount, icon: Tags },
    { label: "Errors logged", value: errorCount, icon: ScrollText },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          A minimal vault for uploading, tagging and finding files stored in MongoDB.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
          >
            <Icon size={18} className="text-[var(--color-accent)]" />
            <p className="mt-3 text-2xl font-semibold">{value}</p>
            <p className="text-sm text-[var(--color-muted)]">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/upload"
          className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          <Upload size={16} /> Upload files
        </Link>
        <Link
          href="/search"
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          <Search size={16} /> Search &amp; browse
        </Link>
      </div>

      <div>
        <h2 className="text-sm font-medium text-[var(--color-muted)]">Recently uploaded</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Nothing uploaded yet. Start by adding a file.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {recent.map((f: IFile & { _id: unknown; uploadedAt: Date }) => (
              <li key={String(f._id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link href={`/edit/${f._id}`} className="font-medium hover:text-[var(--color-accent)]">
                  {f.filename}
                </Link>
                <span className="text-[var(--color-muted)]">
                  {new Date(f.uploadedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
