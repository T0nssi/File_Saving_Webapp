"use client";

import { useState, useEffect, useRef } from "react";
import { Save, RotateCcw, MoreVertical, ChevronDown, Eye, Download, Copy, Edit2 } from "lucide-react";

interface Sheet {
  name: string;
  data: string[][];
}

interface ExcelEditorProps {
  fileId: string;
  filename: string;
  onSave: (sheets: Sheet[]) => Promise<void>;
  initialSheets: Sheet[];
  saving: boolean;
}

export default function ExcelEditor({ fileId, filename, onSave, initialSheets, saving }: ExcelEditorProps) {
  const [sheets, setSheets] = useState<Sheet[]>(initialSheets);
  const [activeSheet, setActiveSheet] = useState(0);
  const [history, setHistory] = useState<Sheet[][]>([initialSheets]);
  const [showMenu, setShowMenu] = useState(false);
  const [editingSheetName, setEditingSheetName] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentSheet = sheets[activeSheet] ?? { name: "", data: [] };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCellChange = (row: number, col: number, value: string) => {
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
    setHistory([...history, newSheets]);
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
    setHistory([...history, newSheets]);
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
    setHistory([...history, newSheets]);
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

  const handleSave = async () => {
    await onSave(sheets);
  };

  const renameSheet = (sheetIndex: number, newName: string) => {
    if (newName.trim()) {
      const newSheets = sheets.map((s, idx) =>
        idx === sheetIndex ? { ...s, name: newName.trim() } : s
      );
      setSheets(newSheets);
      setHistory([...history, newSheets]);
    }
    setEditingSheetName(null);
  };

  const cloneSheet = () => {
    const sheet = sheets[activeSheet];
    if (sheet) {
      const newName = `${sheet.name} (copy)`;
      const newSheet = {
        name: newName,
        data: sheet.data.map(row => [...row]),
      };
      const newSheets = [...sheets, newSheet];
      setSheets(newSheets);
      setHistory([...history, newSheets]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, colIdx: number) => {
    setResizingCol(colIdx);
    e.preventDefault();
  };

  useEffect(() => {
    if (resizingCol === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(50, e.clientX);
      setColumnWidths(prev => ({
        ...prev,
        [resizingCol]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      setResizingCol(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingCol]);

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
        <div className="flex gap-2">
          {sheets.map((sheet, idx) => (
            <div
              key={idx}
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
                    if (e.key === "Escape") setEditingSheetName(null);
                  }}
                  className="w-32 rounded-md border-0 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-offset-1"
                />
              ) : (
                <button
                  onClick={() => setActiveSheet(idx)}
                  onDoubleClick={() => setEditingSheetName(idx)}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-medium"
                  title="Double-click to rename"
                >
                  {sheet.name}
                  {activeSheet === idx && <Edit2 size={12} className="opacity-50" />}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={history.length <= 1}
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={16} />
          </button>

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

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            <Save size={16} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-zinc-50">
              <th className="w-12 border-r border-[var(--color-border)] bg-zinc-100 px-2 py-2 text-center text-xs font-semibold text-[var(--color-muted)]">
                #
              </th>
              {currentSheet.data[0]?.map((_, colIdx) => (
                <th
                  key={colIdx}
                  style={{
                    width: columnWidths[colIdx] ? `${columnWidths[colIdx]}px` : undefined,
                  }}
                  className="relative min-w-[80px] border-r border-[var(--color-border)] bg-zinc-100 px-3 py-2 text-center text-xs font-semibold text-[var(--color-muted)]"
                >
                  {getColumnHeader(colIdx)}
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, colIdx)}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent)]"
                    title="Drag to resize column"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentSheet.data.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-[var(--color-border)] hover:bg-zinc-50">
                <td className="border-r border-[var(--color-border)] bg-zinc-50 px-2 py-2 text-center text-xs font-medium text-[var(--color-muted)]">
                  {rowIdx + 1}
                </td>
                {row.map((cell, colIdx) => (
                  <td
                    key={`${rowIdx}-${colIdx}`}
                    style={{
                      width: columnWidths[colIdx] ? `${columnWidths[colIdx]}px` : undefined,
                    }}
                    className="border-r border-[var(--color-border)] px-3 py-2"
                  >
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                      placeholder={cell === "" ? "empty" : undefined}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 outline-none placeholder:text-gray-300 focus:border-[var(--color-accent)] focus:bg-white"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-[var(--color-muted)]">
        {currentSheet.data.length} rows × {currentSheet.data[0]?.length ?? 0} columns
      </div>
    </div>
  );
}
