"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder as FolderIcon, FolderPlus, Pencil, Trash2, Inbox, LayoutGrid, ChevronRight, Search, X, AlertTriangle } from "lucide-react";
import { PromptModal } from "@/components/Dialog";
import { apiFetch } from "@/lib/apiFetch";
import type { FolderDoc, VaultTotals } from "@/types";

interface Props {
  // null = browsing all files, "root" = files not filed into any folder,
  // otherwise a folder's _id.
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onDropFile: (fileId: string, folderId: string | null) => void;
  refreshKey?: number;
  onChanged?: () => void;
  // Folder deletion cascades to reparent (or, in "delete all" mode, remove)
  // every file inside it, including ones the current user can't see — the
  // API restricts it to admins, so delete/move controls only render for
  // them to avoid a surprise 403.
  canDelete?: boolean;
}

type PromptState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folderId: string; current: string };

// Distinct drag payload types so a drop target can tell a file drag (set by
// FileCard) apart from a folder drag (set here) without guessing from data.
const FILE_DRAG_TYPE = "text/plain";
const FOLDER_DRAG_TYPE = "application/x-folder-id";

const ROOT_KEY = "root";

/** Lazy, level-by-level folder tree: only the top level loads on mount.
 * Expanding a folder fetches (and caches) its children the first time —
 * a wide or deep vault never has to load every folder just to open the
 * sidebar. Typing in the search box switches to a flat, path-annotated
 * result list instead of the tree. */
export default function FolderSidebar({ activeFolderId, onSelect, onDropFile, refreshKey, onChanged, canDelete = false }: Props) {
  const [levelCache, setLevelCache] = useState<Record<string, FolderDoc[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingLevels, setLoadingLevels] = useState<Record<string, boolean>>({});
  const [rootCount, setRootCount] = useState(0);
  const [vaultTotals, setVaultTotals] = useState<VaultTotals | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null); // folder _id, or "root"
  const [query, setQuery] = useState("");
  const [allFolders, setAllFolders] = useState<FolderDoc[] | null>(null);

  const loadLevel = useCallback(async (parentId: string | null) => {
    const cacheKey = parentId ?? ROOT_KEY;
    setLoadingLevels((prev) => ({ ...prev, [cacheKey]: true }));
    try {
      const qs = parentId ? `?parentId=${parentId}` : "";
      const res = await apiFetch(`/api/folders${qs}`);
      const data = await res.json();
      setLevelCache((prev) => ({ ...prev, [cacheKey]: data.folders ?? [] }));
      if (!parentId) {
        if (typeof data.rootCount === "number") setRootCount(data.rootCount);
        if (data.vaultTotals) setVaultTotals(data.vaultTotals);
      }
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
    if (allFolders) loadAllFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function loadAllFolders() {
    const res = await apiFetch("/api/folders?flat=1");
    const data = await res.json();
    setAllFolders(data.folders ?? []);
  }

  useEffect(() => {
    if (query.trim() && !allFolders) loadAllFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const folderPathById = useMemo(() => {
    const byId = new Map((allFolders ?? []).map((f) => [f._id, f]));
    const paths = new Map<string, string>();
    function pathOf(id: string): string {
      if (paths.has(id)) return paths.get(id)!;
      const f = byId.get(id);
      if (!f) return "";
      const parentPath = f.parentId ? pathOf(f.parentId) : "";
      const full = parentPath ? `${parentPath} / ${f.name}` : f.name;
      paths.set(id, full);
      return full;
    }
    (allFolders ?? []).forEach((f) => pathOf(f._id));
    return paths;
  }, [allFolders]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !allFolders) return [];
    return allFolders.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 50);
  }, [query, allFolders]);

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

  async function moveFolder(folderId: string, newParentId: string | null) {
    if (folderId === newParentId) return;
    const res = await apiFetch(`/api/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: newParentId ?? "root" }),
    });
    if (res.ok) {
      reloadVisible();
      if (allFolders) loadAllFolders();
      onChanged?.();
    }
  }

  async function runDelete(mode: "moveUp" | "deleteAll") {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/folders/${target.id}?mode=${mode}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        if (activeFolderId === target.id) onSelect(null);
        reloadVisible();
        if (allFolders) loadAllFolders();
        onChanged?.();
      }
    } finally {
      setDeleting(false);
    }
  }

  function handleFolderDrop(e: React.DragEvent, targetFolderId: string | null) {
    e.preventDefault();
    setDragOverId(null);
    if (e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) {
      const draggedFolderId = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
      if (draggedFolderId) moveFolder(draggedFolderId, targetFolderId);
      return;
    }
    const fileId = e.dataTransfer.getData(FILE_DRAG_TYPE);
    if (fileId) onDropFile(fileId, targetFolderId);
  }

  function renderFolder(f: FolderDoc, depth: number) {
    const active = activeFolderId === f._id;
    const dragOver = dragOverId === f._id;
    const hasChildren = (f.childFolderCount ?? 0) > 0;
    const isExpanded = !!expanded[f._id];

    return (
      <div key={f._id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, f._id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE) && !e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
            e.preventDefault();
            setDragOverId(f._id);
          }}
          onDragLeave={() => setDragOverId((id) => (id === f._id ? null : id))}
          onDrop={(e) => handleFolderDrop(e, f._id)}
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
            title={`${f.folderCountRecursive ?? 0} folders · ${f.fileCountRecursive ?? 0} files`}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1.5 text-left"
          >
            <FolderIcon size={14} className={active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"} />
            <span className="truncate">{f.name}</span>
            <span className="ml-auto shrink-0 pl-1 text-xs text-[var(--color-muted)]">
              {f.fileCountRecursive ?? f.fileCount ?? 0}
            </span>
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

      <div className="relative mb-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาโฟลเดอร์…"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-6 pr-6 text-xs outline-none focus-visible:border-[var(--color-accent)]"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear folder search"
            onClick={() => setQuery("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted)] hover:bg-zinc-100"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {query.trim() ? (
        <div className="flex flex-col gap-0.5">
          {searchResults.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--color-muted)]">ไม่พบโฟลเดอร์ที่ตรงกัน</p>
          ) : (
            searchResults.map((f) => (
              <button
                key={f._id}
                type="button"
                onClick={() => {
                  onSelect(f._id);
                  setQuery("");
                }}
                className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  <FolderIcon size={13} className="text-[var(--color-muted)]" />
                  {f.name}
                </span>
                <span className="truncate pl-5 text-[11px] text-[var(--color-muted)]">
                  {folderPathById.get(f._id) || f.name}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(null)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              e.preventDefault();
              setDragOverId("all");
            }}
            onDragLeave={() => setDragOverId((id) => (id === "all" ? null : id))}
            onDrop={(e) => handleFolderDrop(e, null)}
            title="Drop a folder here to move it to the top level"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
              dragOverId === "all"
                ? "bg-blue-50 text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]"
                : activeFolderId === null
                ? "bg-blue-50 text-[var(--color-accent)]"
                : "hover:bg-zinc-100"
            }`}
          >
            <LayoutGrid size={14} className={activeFolderId === null ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"} />
            ไฟล์ทั้งหมด
            {vaultTotals && (
              <span className="ml-auto shrink-0 text-xs text-[var(--color-muted)]">
                {vaultTotals.folderCount} โฟลเดอร์ · {vaultTotals.fileCount} ไฟล์
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelect("root")}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE) && !e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              e.preventDefault();
              setDragOverId("root");
            }}
            onDragLeave={() => setDragOverId((id) => (id === "root" ? null : id))}
            onDrop={(e) => handleFolderDrop(e, null)}
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
        </>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={() => !deleting && setDeleteTarget(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle size={16} className="shrink-0 text-[var(--color-danger)]" />
              ลบโฟลเดอร์ &quot;{deleteTarget.name}&quot;?
            </p>
            <p className="text-xs text-[var(--color-muted)]">เลือกวิธีลบโฟลเดอร์นี้และเนื้อหาข้างใน</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => runDelete("moveUp")}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                <span className="block font-medium">ย้ายเนื้อหาออกมาก่อนลบ</span>
                <span className="block text-xs text-[var(--color-muted)]">ไฟล์และโฟลเดอร์ย่อยข้างในจะถูกย้ายขึ้นไปหนึ่งระดับ ไม่มีอะไรถูกลบทิ้ง</span>
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => runDelete("deleteAll")}
                className="rounded-md border border-[var(--color-danger)] bg-red-50 px-3 py-2 text-left text-sm text-[var(--color-danger)] hover:bg-red-100 disabled:opacity-50"
              >
                <span className="block font-medium">ลบทั้งหมด</span>
                <span className="block text-xs">ลบโฟลเดอร์ย่อยและไฟล์ข้างในทั้งหมดถาวร กู้คืนไม่ได้</span>
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
