"use client";

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { apiFetch } from "@/lib/apiFetch";

interface Stats {
  fileCount: number;
  logicalBytes: number;
  mongoStorageBytes: number | null;
}

// refreshKey lets a parent force a refetch right after an upload/delete
// without this component needing to know why.
export default function StoragePanel({ refreshKey }: { refreshKey?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    apiFetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, [refreshKey]);

  if (!stats) return null;

  return (
    <div className="flex w-full flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs sm:w-56">
      <div className="mb-0.5 flex items-center gap-1.5 text-[var(--color-muted)]">
        <HardDrive size={13} />
        <span className="font-medium uppercase tracking-wide">พื้นที่จัดเก็บ</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[var(--color-muted)]">ไฟล์ทั้งหมด</span>
        <span className="font-medium">{stats.fileCount}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[var(--color-muted)]">ขนาดรวม</span>
        <span className="font-medium">{formatBytes(stats.logicalBytes)}</span>
      </div>
      {stats.mongoStorageBytes !== null && (
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--color-muted)]">ใช้จริงใน MongoDB</span>
          <span className="font-medium">{formatBytes(stats.mongoStorageBytes)}</span>
        </div>
      )}
    </div>
  );
}
