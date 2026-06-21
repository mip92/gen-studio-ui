'use client';

import { useEffect, useRef, useState } from 'react';

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

// ── Multi-select dropdown for column filters ─────────────────────────────────

export function MultiSelect({ options, value, onChange }: {
  options:  readonly string[];
  value:    string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (opt: string) => {
    const set = new Set(value);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    onChange([...set]);
  };

  const label = value.length === 0 ? 'all' : `${value.length} selected`;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] normal-case font-normal px-2 py-0.5 rounded border transition-colors ${
          value.length > 0
            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
            : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
        }`}
      >
        {label} <span className="opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 left-0 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded shadow-lg py-1">
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
        </div>
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
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

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
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] bg-zinc-900 border border-zinc-700 rounded shadow-lg py-1 max-h-[300px] overflow-y-auto">
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
        </div>
      )}
    </div>
  );
}
