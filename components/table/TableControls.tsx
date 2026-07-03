'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shared TanStack-table UI controls — one source of truth for the column
 * header (sort toggle + optional filter dropdown) and the two multi-select
 * filter dropdowns. Used by QueueTable and the Voices table so both look and
 * behave identically. Extracted from QueueTable 2026-06-21.
 */

// ── Header cell with built-in sort toggle + optional filter dropdown ─────────

export function HeaderCell({ label, column, filter }: {
  label:   string;
  column:  { getCanSort: () => boolean; getIsSorted: () => false | 'asc' | 'desc'; toggleSorting: (desc?: boolean) => void };
  filter?: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => column.toggleSorting(sorted === 'asc')}
        disabled={!column.getCanSort()}
        className="flex items-center gap-1 text-left hover:text-zinc-200 disabled:hover:text-inherit disabled:cursor-default"
      >
        <span className={sorted ? 'text-zinc-100' : ''}>{label}</span>
        {sorted && <span className="text-emerald-400">{sorted === 'asc' ? '↑' : '↓'}</span>}
      </button>
      {filter}
    </div>
  );
}

// ── Anchored, portalled dropdown panel ───────────────────────────────────────
// The filter menus live inside the table, which sits in an `overflow-x-auto`
// scroll container. An absolutely-positioned menu is clipped by that container
// whenever the table is shorter than the menu — most visibly on an empty
// "0 rows" table, where the menu vanished below the fold. Rendering the panel
// into a document.body portal with position:fixed escapes every overflow/clip
// context; we anchor it to the trigger button's rect and keep it in sync on
// scroll/resize.

function useAnchoredPanel(open: boolean, setOpen: (v: boolean) => void) {
  const btnRef   = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const top = b.bottom + 4;
      setPos({ top, left: b.left, maxHeight: Math.max(120, window.innerHeight - top - 8) });
    };
    compute();
    window.addEventListener('resize', compute);
    // capture=true so we also catch scrolling of any ancestor scroll container.
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, setOpen]);

  return { btnRef, panelRef, pos };
}

function DropdownPanel({ panelRef, pos, minWidth, children }: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  pos:      { top: number; left: number; maxHeight: number } | null;
  minWidth: number;
  children: React.ReactNode;
}) {
  if (!pos || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth, maxHeight: pos.maxHeight }}
      className="z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg py-1 overflow-y-auto"
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Multi-select dropdown for column filters ─────────────────────────────────

export function MultiSelect({ options, value, onChange }: {
  options:  readonly string[];
  value:    string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = useAnchoredPanel(open, setOpen);

  const toggle = (opt: string) => {
    const set = new Set(value);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    onChange([...set]);
  };

  const label = value.length === 0 ? 'all' : `${value.length} selected`;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[10px] normal-case font-normal px-2 py-0.5 rounded border transition-colors ${
          value.length > 0
            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
            : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
        }`}
      >
        {label} <span className="opacity-60">▾</span>
      </button>
      {open && (
        <DropdownPanel panelRef={panelRef} pos={pos} minWidth={140}>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="block w-full text-left px-3 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            >
              clear
            </button>
          )}
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 cursor-pointer">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)}
                     className="accent-emerald-500" />
              {opt}
            </label>
          ))}
        </DropdownPanel>
      )}
    </div>
  );
}

/** Multi-select where the visible label differs from the stored value — e.g.
 *  Project filter shows project names but stores slugs/ids. */
export function MultiSelectLabeled({ options, value, onChange }: {
  options:  { value: string; label: string }[];
  value:    string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = useAnchoredPanel(open, setOpen);

  const toggle = (val: string) => {
    const set = new Set(value);
    if (set.has(val)) set.delete(val); else set.add(val);
    onChange([...set]);
  };

  const buttonLabel = value.length === 0
    ? 'all'
    : value.length === 1
      ? (options.find((o) => o.value === value[0])?.label ?? value[0])
      : `${value.length} selected`;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[10px] normal-case font-normal px-2 py-0.5 rounded border transition-colors max-w-[140px] truncate ${
          value.length > 0
            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
            : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
        }`}
        title={buttonLabel}
      >
        {buttonLabel} <span className="opacity-60">▾</span>
      </button>
      {open && (
        <DropdownPanel panelRef={panelRef} pos={pos} minWidth={180}>
          {options.length === 0 && (
            <div className="px-3 py-1 text-[11px] text-zinc-600 italic">no options</div>
          )}
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="block w-full text-left px-3 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            >
              clear
            </button>
          )}
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 cursor-pointer">
              <input type="checkbox" checked={value.includes(opt.value)} onChange={() => toggle(opt.value)}
                     className="accent-emerald-500" />
              <span className="truncate">{opt.label}</span>
            </label>
          ))}
        </DropdownPanel>
      )}
    </div>
  );
}
