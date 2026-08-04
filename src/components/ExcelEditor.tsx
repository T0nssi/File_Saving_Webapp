"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Save, RotateCcw, MoreVertical, ChevronDown, Eye, Download, Copy, Edit2 } from "lucide-react";

interface Sheet {
  name: string;
  data: string[][];
}

interface ExcelEditorProps {
  fileId: string;
  filename: string;
  onSave: (sheets: Sheet[]) => Promise<boolean>;
  initialSheets: Sheet[];
  saving: boolean;
  // True when the viewer only has "view" share access — the server rejects
  // the save request either way, but disabling editing here avoids letting
  // someone type changes for several minutes before finding that out.
  readOnly?: boolean;
}

const MAX_HISTORY = 50;
const DEFAULT_COL_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_TABLE_HEIGHT = 480;
const MIN_TABLE_HEIGHT = 160;

function columnWidthsStorageKey(fileId: string) {
  return `excel-editor:col-widths:${fileId}`;
}
function rowHeightsStorageKey(fileId: string) {
  return `excel-editor:row-heights:${fileId}`;
}
function tableHeightStorageKey(fileId: string) {
  return `excel-editor:table-height:${fileId}`;
}

export default function ExcelEditor({ fileId, filename, onSave, initialSheets, saving, readOnly = false }: ExcelEditorProps) {
  const [sheets, setSheets] = useState<Sheet[]>(initialSheets);
  const [activeSheet, setActiveSheet] = useState(0);
  const [history, setHistory] = useState<Sheet[][]>([initialSheets]);
  const [showMenu, setShowMenu] = useState(false);
  const [editingSheetName, setEditingSheetName] = useState<number | null>(null);
  const [sheetNameError, setSheetNameError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});
  const [tableHeight, setTableHeight] = useState(DEFAULT_TABLE_HEIGHT);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeResizeCleanup = useRef<(() => void) | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const currentSheet = sheets[activeSheet] ?? { name: "", data: [] };

  const pushHistory = useCallback((newSheets: Sheet[]) => {
    setHistory((prev) => {
      const next = [...prev, newSheets];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, []);

  // Load persisted column widths, row heights, and table height for this file
  useEffect(() => {
    try {
      const rawCols = window.localStorage.getItem(columnWidthsStorageKey(fileId));
      if (rawCols) setColumnWidths(JSON.parse(rawCols));
      const rawRows = window.localStorage.getItem(rowHeightsStorageKey(fileId));
      if (rawRows) setRowHeights(JSON.parse(rawRows));
      const rawHeight = window.localStorage.getItem(tableHeightStorageKey(fileId));
      if (rawHeight) {
        const parsed = Number(rawHeight);
        if (Number.isFinite(parsed) && parsed >= MIN_TABLE_HEIGHT) setTableHeight(parsed);
      }
    } catch {
      // Ignore malformed/unavailable storage
    }
  }, [fileId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clean up any in-flight column/row-resize listeners if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      activeResizeCleanup.current?.();
    };
  }, []);

  // The table container's height is user-resizable via native CSS `resize: vertical`
  // (drag the bottom-right corner). Persist that size per file so it survives reloads.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const height = Math.round(entry.contentRect.height);
      if (height < MIN_TABLE_HEIGHT) return;
      try {
        window.localStorage.setItem(tableHeightStorageKey(fileId), String(height));
      } catch {
        // Ignore storage failures (quota, privacy mode, etc.)
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fileId]);

  const handleCellChange = (row: number, col: number, value: string) => {
    if (readOnly) return;
    const newSheets = sheets.map((s, idx) =>
      idx === activeSheet
        ? {
            ...s,
            data: s.data.map((r, ridx) =>
              ridx === row
                ? r.map((c, cidx) => (cidx === col ? value : c))
                : r
            ),
          }
        : s
    );
    setSheets(newSheets);
    pushHistory(newSheets);
  };

  const addRow = () => {
    const newSheets = sheets.map((s, idx) =>
      idx === activeSheet
        ? {
            ...s,
            data: [...s.data, Array(s.data[0]?.length ?? 10).fill("")],
          }
        : s
    );
    setSheets(newSheets);
    pushHistory(newSheets);
  };

  const addColumn = () => {
    const newSheets = sheets.map((s, idx) =>
      idx === activeSheet
        ? {
            ...s,
            data: s.data.map((r) => [...r, ""]),
          }
        : s
    );
    setSheets(newSheets);
    pushHistory(newSheets);
  };

  const undo = () => {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      const previousState = newHistory[newHistory.length - 1];
      if (previousState) {
        setSheets(previousState);
        setHistory(newHistory);
      }
    }
  };

  const handleSave = useCallback(async () => {
    if (saving || readOnly) return;
    const success = await onSave(sheets);
    if (success) {
      // Collapse history back to a single baseline so the dirty check and undo
      // button both reflect "nothing to lose" right after a successful save.
      setHistory([sheets]);
    }
  }, [onSave, sheets, saving, readOnly]);

  // Ctrl+S / Cmd+S saves instead of triggering the browser's save-page dialog
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Warn on tab close/refresh if there are unsaved edits (history grew past the baseline).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (history.length > 1) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [history.length]);

  const isDuplicateName = (name: string, excludeIndex: number) => {
    const key = name.trim().toLowerCase();
    return sheets.some((s, idx) => idx !== excludeIndex && s.name.trim().toLowerCase() === key);
  };

  const renameSheet = (sheetIndex: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditingSheetName(null);
      return;
    }
    if (isDuplicateName(trimmed, sheetIndex)) {
      setSheetNameError(`A sheet named "${trimmed}" already exists`);
      return;
    }
    const newSheets = sheets.map((s, idx) =>
      idx === sheetIndex ? { ...s, name: trimmed } : s
    );
    setSheets(newSheets);
    pushHistory(newSheets);
    setSheetNameError(null);
    setEditingSheetName(null);
  };

  const cloneSheet = () => {
    const sheet = sheets[activeSheet];
    if (!sheet) return;

    let candidate = `${sheet.name} (copy)`;
    let suffix = 2;
    while (isDuplicateName(candidate, -1)) {
      candidate = `${sheet.name} (copy ${suffix})`;
      suffix += 1;
    }

    const newSheet = {
      name: candidate,
      data: sheet.data.map(row => [...row]),
    };
    const newSheets = [...sheets, newSheet];
    setSheets(newSheets);
    pushHistory(newSheets);
  };

  const handleColResizeMouseDown = (e: React.MouseEvent, colIdx: number) => {
    const startX = e.clientX;
    const startWidth = columnWidths[colIdx] || DEFAULT_COL_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + delta);
      setColumnWidths(prev => {
        const next = { ...prev, [colIdx]: newWidth };
        try {
          window.localStorage.setItem(columnWidthsStorageKey(fileId), JSON.stringify(next));
        } catch {
          // Ignore storage failures (quota, privacy mode, etc.)
        }
        return next;
      });
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      activeResizeCleanup.current = null;
    };

    const handleMouseUp = () => {
      cleanup();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    activeResizeCleanup.current = cleanup;
    e.preventDefault();
  };

  const handleRowResizeMouseDown = (e: React.MouseEvent, rowIdx: number) => {
    const startY = e.clientY;
    const startHeight = rowHeights[rowIdx] || DEFAULT_ROW_HEIGHT;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(20, startHeight + delta);
      setRowHeights(prev => {
        const next = { ...prev, [rowIdx]: newHeight };
        try {
          window.localStorage.setItem(rowHeightsStorageKey(fileId), JSON.stringify(next));
        } catch {
          // Ignore storage failures (quota, privacy mode, etc.)
        }
        return next;
      });
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      activeResizeCleanup.current = null;
    };

    const handleMouseUp = () => {
      cleanup();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    activeResizeCleanup.current = cleanup;
    e.preventDefault();
  };

  const getColumnHeader = (index: number): string => {
    let header = "";
    let num = index;
    while (num >= 0) {
      header = String.fromCharCode(65 + (num % 26)) + header;
      num = Math.floor(num / 26) - 1;
    }
    return header;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            {sheets.map((sheet, idx) => (
              <div
                key={`${idx}:${sheet.name}`}
                className={`rounded-md transition-colors ${
                  activeSheet === idx
                    ? "bg-[var(--color-accent)] text-white"
                    : "bg-zinc-100 hover:bg-zinc-200"
                }`}
              >
                {editingSheetName === idx ? (
                  <input
                    autoFocus
                    type="text"
                    defaultValue={sheet.name}
                    onBlur={(e) => renameSheet(idx, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameSheet(idx, e.currentTarget.value);
                      if (e.key === "Escape") {
                        setSheetNameError(null);
                        setEditingSheetName(null);
                      }
                    }}
                    className="w-32 rounded-md border-0 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-offset-1"
                  />
                ) : (
                  <button
                    onClick={() => setActiveSheet(idx)}
                    onDoubleClick={() => !readOnly && setEditingSheetName(idx)}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium"
                    title={readOnly ? undefined : "Double-click to rename"}
                  >
                    {sheet.name}
                    {activeSheet === idx && !readOnly && <Edit2 size={12} className="opacity-50" />}
                  </button>
                )}
              </div>
            ))}
          </div>
          {sheetNameError && (
            <p className="text-xs text-[var(--color-danger)]">{sheetNameError}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {readOnly && (
            <span className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              View only
            </span>
          )}

          {!readOnly && (
            <button
              onClick={undo}
              disabled={history.length <= 1}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
              title="Undo (Ctrl+Z)"
            >
              <RotateCcw size={16} />
            </button>
          )}

          {!readOnly && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
              >
                <MoreVertical size={16} />
              </button>

              {showMenu && (
                <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-[var(--color-border)] bg-white shadow-lg">
                  <button
                    onClick={() => {
                      addRow();
                      setShowMenu(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Add row
                  </button>
                  <button
                    onClick={() => {
                      addColumn();
                      setShowMenu(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Add column
                  </button>
                  <div className="border-t border-[var(--color-border)]" />
                  <button
                    onClick={() => {
                      cloneSheet();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    <Copy size={14} /> Clone sheet
                  </button>
                </div>
              )}
            </div>
          )}

          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
              title="Save (Ctrl+S)"
            >
              <Save size={16} /> {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        style={{ height: `${tableHeight}px`, minHeight: `${MIN_TABLE_HEIGHT}px` }}
        className="resize-y overflow-auto rounded-lg border border-[var(--color-border)]"
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-zinc-50">
              <th className="sticky left-0 top-0 z-20 w-12 border-r border-b border-[var(--color-border)] bg-zinc-100 px-2 py-2 text-center text-xs font-semibold text-[var(--color-muted)]">
                #
              </th>
              {currentSheet.data[0]?.map((_, colIdx) => (
                <th
                  key={colIdx}
                  style={{
                    width: columnWidths[colIdx] ? `${columnWidths[colIdx]}px` : "auto",
                    minWidth: "80px",
                  }}
                  className="sticky top-0 z-10 relative border-r border-b border-[var(--color-border)] bg-zinc-100 px-3 py-2 text-center text-xs font-semibold text-[var(--color-muted)] select-none"
                >
                  {getColumnHeader(colIdx)}
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => handleColResizeMouseDown(e, colIdx)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--color-accent)] hover:w-2 transition-all"
                    title="Drag to resize column"
                    style={{
                      backgroundColor: "transparent",
                      transition: "background-color 200ms, width 200ms",
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentSheet.data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={rowHeights[rowIdx] ? { height: `${rowHeights[rowIdx]}px` } : undefined}
                className="border-b border-[var(--color-border)] hover:bg-zinc-50"
              >
                <td className="sticky left-0 z-[1] relative border-r border-[var(--color-border)] bg-zinc-50 px-2 py-2 text-center text-xs font-medium text-[var(--color-muted)]">
                  {rowIdx + 1}
                  {/* Row resize handle */}
                  <div
                    onMouseDown={(e) => handleRowResizeMouseDown(e, rowIdx)}
                    className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize hover:bg-[var(--color-accent)] hover:h-2 transition-all"
                    title="Drag to resize row"
                    style={{
                      backgroundColor: "transparent",
                      transition: "background-color 200ms, height 200ms",
                    }}
                  />
                </td>
                {row.map((cell, colIdx) => (
                  <td
                    key={`${rowIdx}-${colIdx}`}
                    style={{
                      width: columnWidths[colIdx] ? `${columnWidths[colIdx]}px` : "auto",
                      minWidth: "80px",
                    }}
                    className="border-r border-[var(--color-border)] px-3 py-2 overflow-hidden"
                  >
                    <input
                      type="text"
                      value={cell ?? ""}
                      onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                      readOnly={readOnly}
                      placeholder={(cell === "" || cell === null) ? "empty" : undefined}
                      className={`w-full rounded border border-transparent bg-transparent px-1 py-1 outline-none placeholder:text-gray-300 ${readOnly ? "cursor-default" : "focus:border-[var(--color-accent)] focus:bg-white focus:ring-1 focus:ring-offset-0"}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-[var(--color-muted)]">
        {currentSheet.data.length} rows × {currentSheet.data[0]?.length ?? 0} columns · drag the bottom-right corner to resize the table
      </div>
    </div>
  );
}
