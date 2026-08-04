"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder as FolderIcon, FolderPlus, Pencil, Trash2, Inbox, LayoutGrid, ChevronRight } from "lucide-react";
import { PromptModal, ConfirmModal } from "@/components/Dialog";
import { apiFetch } from "@/lib/apiFetch";
import type { FolderDoc } from "@/types";

interface Props {
  // null = browsing all files, "root" = files not filed into any folder,
  // otherwise a folder's _id.
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onDropFile: (fileId: string, folderId: string | null) => void;
  refreshKey?: number;
  onChanged?: () => void;
  // Folder deletion cascades to reparent every file inside it, including
  // ones the current user can't see — the API restricts it to admins, so
  // the delete button only renders for them to avoid a surprise 403.
  canDelete?: boolean;
}

type PromptState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folderId: string; current: string };

const ROOT_KEY = "root";

/** Lazy, level-by-level folder tree: only the top level loads on mount.
 * Expanding a folder fetches (and caches) its children the first time —
 * a wide or deep vault never has to load every folder just to open the
 * sidebar. */
export default function FolderSidebar({ activeFolderId, onSelect, onDropFile, refreshKey, onChanged, canDelete = false }: Props) {
  const [levelCache, setLevelCache] = useState<Record<string, FolderDoc[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingLevels, setLoadingLevels] = useState<Record<string, boolean>>({});
  const [rootCount, setRootCount] = useState(0);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null); // folder _id, or "root"

  const loadLevel = useCallback(async (parentId: string | null) => {
    const cacheKey = parentId ?? ROOT_KEY;
    setLoadingLevels((prev) => ({ ...prev, [cacheKey]: true }));
    try {
      const qs = parentId ? `?parentId=${parentId}` : "";
      const res = await apiFetch(`/api/folders${qs}`);
      const data = await res.json();
      setLevelCache((prev) => ({ ...prev, [cacheKey]: data.folders ?? [] }));
      if (!parentId && typeof data.rootCount === "number") setRootCount(data.rootCount);
    } finally {
      setLoadingLevels((prev) => ({ ...prev, [cacheKey]: false }));
    }
  }, []);

  const reloadVisible = useCallback(() => {
    loadLevel(null);
    Object.keys(expanded)
      .filter((id) => expanded[id])
      .forEach((id) => loadLevel(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLevel, expanded]);

  useEffect(() => {
    loadLevel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshKey === undefined) return;
    reloadVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function toggleExpand(id: string) {
    const willExpand = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: willExpand }));
    if (willExpand && !levelCache[id]) loadLevel(id);
  }

  function openCreate() {
    const insideFolder = activeFolderId && activeFolderId !== "root" ? activeFolderId : null;
    setPromptState({ mode: "create", parentId: insideFolder });
  }

  function openRename(id: string, current: string) {
    setPromptState({ mode: "rename", folderId: id, current });
  }

  async function submitPrompt(name: string) {
    const trimmed = name.trim();
    const state = promptState;
    setPromptState(null);
    if (!trimmed || !state) return;

    if (state.mode === "create") {
      const res = await apiFetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId: state.parentId }),
      });
      if (res.ok) {
        // Make sure the level the new folder landed in is loaded and expanded.
        if (state.parentId) setExpanded((prev) => ({ ...prev, [state.parentId as string]: true }));
        await loadLevel(state.parentId);
        onChanged?.();
      }
    } else {
      if (trimmed === state.current) return;
      const res = await apiFetch(`/api/folders/${state.folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) reloadVisible();
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const res = await apiFetch(`/api/folders/${target.id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeFolderId === target.id) onSelect(null);
      reloadVisible();
      onChanged?.();
    }
  }

  function renderFolder(f: FolderDoc, depth: number) {
    const active = activeFolderId === f._id;
    const dragOver = dragOverId === f._id;
    const hasChildren = (f.childFolderCount ?? 0) > 0;
    const isExpanded = !!expanded[f._id];

    return (
      <div key={f._id}>
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("text/plain")) return;
            e.preventDefault();
            setDragOverId(f._id);
          }}
          onDragLeave={() => setDragOverId((id) => (id === f._id ? null : id))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const fileId = e.dataTransfer.getData("text/plain");
            if (fileId) onDropFile(fileId, f._id);
          }}
          className={`group flex items-center gap-1 rounded-md pr-1 text-sm ${
            dragOver
              ? "bg-blue-50 text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]"
              : active
              ? "bg-blue-50 text-[var(--color-accent)]"
              : "text-[var(--color-text)] hover:bg-zinc-100"
          }`}
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          <button
            type="button"
            aria-label={hasChildren ? (isExpanded ? `Collapse ${f.name}` : `Expand ${f.name}`) : undefined}
            onClick={() => hasChildren && toggleExpand(f._id)}
            className={`flex h-6 w-5 shrink-0 items-center justify-center text-[var(--color-muted)] ${
              hasChildren ? "" : "invisible"
            }`}
          >
            <ChevronRight size={12} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => onSelect(f._id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1.5 text-left"
          >
            <FolderIcon size={14} className={active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"} />
            <span className="truncate">{f.name}</span>
            <span className="ml-auto shrink-0 pl-1 text-xs text-[var(--color-muted)]">{f.fileCount ?? 0}</span>
          </button>
          <button
            type="button"
            aria-label={`Rename ${f.name}`}
            onClick={() => openRename(f._id, f.name)}
            className="hidden shrink-0 rounded p-1 text-[var(--color-muted)] hover:bg-zinc-200 group-hover:block"
          >
            <Pencil size={12} />
          </button>
          {canDelete && (
            <button
              type="button"
              aria-label={`Delete ${f.name}`}
              onClick={() => setDeleteTarget({ id: f._id, name: f.name })}
              className="hidden shrink-0 rounded p-1 text-[var(--color-muted)] hover:bg-red-50 hover:text-[var(--color-danger)] group-hover:block"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {isExpanded && (
          <>
            {loadingLevels[f._id] && !levelCache[f._id] && (
              <p className="py-1 text-xs text-[var(--color-muted)]" style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}>
                กำลังโหลด…
              </p>
            )}
            {(levelCache[f._id] ?? []).map((c) => renderFolder(c, depth + 1))}
          </>
        )}
      </div>
    );
  }

  const rootList = levelCache[ROOT_KEY] ?? [];

  return (
    <div className="flex w-full shrink-0 flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:w-56">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">โฟลเดอร์</span>
        <button
          type="button"
          aria-label="New folder"
          onClick={openCreate}
          className="rounded p-1 text-[var(--color-muted)] hover:bg-zinc-100 hover:text-[var(--color-accent)]"
        >
          <FolderPlus size={15} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
          activeFolderId === null ? "bg-blue-50 text-[var(--color-accent)]" : "hover:bg-zinc-100"
        }`}
      >
        <LayoutGrid size={14} className={activeFolderId === null ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"} />
        ไฟล์ทั้งหมด
      </button>

      <button
        type="button"
        onClick={() => onSelect("root")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/plain")) return;
          e.preventDefault();
          setDragOverId("root");
        }}
        onDragLeave={() => setDragOverId((id) => (id === "root" ? null : id))}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverId(null);
          const fileId = e.dataTransfer.getData("text/plain");
          if (fileId) onDropFile(fileId, null);
        }}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
          dragOverId === "root"
            ? "bg-blue-50 text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]"
            : activeFolderId === "root"
            ? "bg-blue-50 text-[var(--color-accent)]"
            : "hover:bg-zinc-100"
        }`}
      >
        <Inbox size={14} className={activeFolderId === "root" ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"} />
        ยังไม่จัดหมวด
        <span className="ml-auto text-xs text-[var(--color-muted)]">{rootCount}</span>
      </button>

      <div className="my-1 border-t border-[var(--color-border)]" />

      {loadingLevels[ROOT_KEY] && !levelCache[ROOT_KEY] ? (
        <p className="px-2 py-1 text-xs text-[var(--color-muted)]">กำลังโหลด…</p>
      ) : rootList.length === 0 ? (
        <p className="px-2 py-1 text-xs text-[var(--color-muted)]">ยังไม่มีโฟลเดอร์ กด + เพื่อสร้าง</p>
      ) : (
        rootList.map((f) => renderFolder(f, 0))
      )}

      {promptState && (
        <PromptModal
          title={promptState.mode === "create" ? "ชื่อโฟลเดอร์ใหม่" : "เปลี่ยนชื่อโฟลเดอร์"}
          defaultValue={promptState.mode === "rename" ? promptState.current : ""}
          submitLabel={promptState.mode === "create" ? "สร้าง" : "บันทึก"}
          onSubmit={submitPrompt}
          onCancel={() => setPromptState(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`ลบโฟลเดอร์ "${deleteTarget.name}"? ไฟล์และโฟลเดอร์ย่อยข้างในจะถูกย้ายออกมาแทนการลบทิ้ง`}
          danger
          confirmLabel="ลบโฟลเดอร์"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
