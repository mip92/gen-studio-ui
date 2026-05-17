'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table';
import {
  api,
  QueueListResponse,
  QueueRow,
  QueueJobType,
  QueueSortField,
} from '../lib/api';

const POLL_MS = 3000;

const ALL_TYPES: QueueJobType[] = ['training', 'dataset', 'scene', 'video', 'video_upscale', 'tts'];
const ALL_STATUSES = [
  'pending', 'blocked',
  'preparing', 'captioning', 'training', 'running',
  'completed', 'failed', 'cancelled',
];
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

type ProjectLinks = {
  chars: Map<string, { characterId: string; profiles: Map<string, string> }>;
  shots: Map<string, { shotId: string; sceneKey: string }>;
};

export interface QueueTableProps {
  /** Initial sort applied when the user hasn't manually clicked a header yet. */
  initialSort?:     { id: QueueSortField; desc: boolean };
  /** Statuses pre-selected in the Status column filter dropdown. The user can
   *  freely add or remove values from there — this is just a starting set. */
  initialStatuses?: string[];
  /** Types pre-selected in the Type column filter dropdown. */
  initialTypes?:    QueueJobType[];
}

/**
 * Map TanStack sorting + filters + pagination state to /pipeline/queue params.
 * Server-side is authoritative; TanStack runs in manual mode and owns UI state.
 * All three tabs use the same endpoint — the only difference between them is
 * which filters they pre-populate in the column dropdowns.
 */
function tsStateToApiParams(
  sorting:       SortingState,
  columnFilters: ColumnFiltersState,
  pagination:    PaginationState,
) {
  const sortId = sorting[0]?.id as QueueSortField | undefined;
  const order: 'asc' | 'desc' = sorting[0]?.desc === false ? 'asc' : 'desc';

  const typeFilter   = columnFilters.find((f) => f.id === 'type')?.value   as string[] | undefined;
  const statusFilter = columnFilters.find((f) => f.id === 'status')?.value as string[] | undefined;

  return {
    sort:   sortId,
    order,
    page:   pagination.pageIndex + 1,
    limit:  pagination.pageSize,
    type:   typeFilter   && typeFilter.length   > 0 ? (typeFilter   as QueueJobType[]) : undefined,
    status: statusFilter && statusFilter.length > 0 ?  statusFilter                    : undefined,
  };
}

export default function QueueTable({
  initialSort     = { id: 'queuedAt', desc: true },
  initialStatuses = [],
  initialTypes    = [],
}: QueueTableProps) {
  const [sorting,    setSorting]    = useState<SortingState>([initialSort]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const init: ColumnFiltersState = [];
    if (initialStatuses.length > 0) init.push({ id: 'status', value: initialStatuses });
    if (initialTypes.length    > 0) init.push({ id: 'type',   value: initialTypes });
    return init;
  });

  const [data,  setData]  = useState<QueueListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, ProjectLinks>>({});
  const inflightSlugs = useRef<Set<string>>(new Set());

  const filterKey  = useMemo(() => JSON.stringify(columnFilters), [columnFilters]);
  const sortingKey = useMemo(() => JSON.stringify(sorting),       [sorting]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.pipelineQueue(tsStateToApiParams(sorting, columnFilters, pagination));
      if (!res || !Array.isArray((res as Partial<QueueListResponse>).rows)) {
        setError('Backend returned the old queue shape — restart gen-studio for the new /pipeline/queue endpoint.');
        return;
      }
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // sortingKey/filterKey are stable identity keys for sorting/columnFilters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortingKey, filterKey, pagination.pageIndex, pagination.pageSize]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!data?.rows) return;
    const slugs = new Set<string>();
    for (const r of data.rows) slugs.add(r.projectSlug);

    for (const slug of slugs) {
      if (links[slug] || inflightSlugs.current.has(slug)) continue;
      inflightSlugs.current.add(slug);
      void Promise.all([api.listCharacters(slug), api.listScenes(slug)])
        .then(([chars, scenesRes]) => {
          const charMap: ProjectLinks['chars'] = new Map();
          for (const c of chars) {
            const profileMap = new Map<string, string>();
            for (const p of c.profiles) profileMap.set(p.profileCode, p.id);
            charMap.set(c.code, { characterId: c.id, profiles: profileMap });
          }
          const shotMap: ProjectLinks['shots'] = new Map();
          for (const s of scenesRes.scenes) {
            for (const sh of s.shots) shotMap.set(sh.shotCode, { shotId: sh.id, sceneKey: s.sceneKey });
          }
          setLinks((prev) => ({ ...prev, [slug]: { chars: charMap, shots: shotMap } }));
        })
        .catch(() => { /* leave links unset */ })
        .finally(() => { inflightSlugs.current.delete(slug); });
    }
  }, [data, links]);

  const move = async (type: QueueJobType, id: string, direction: 'up' | 'down') => {
    setBusy(`${type}:${id}:${direction}`);
    try { await api.pipelineMove(type, id, direction); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  const cancel = async (type: QueueJobType, id: string) => {
    if (!confirm(`Cancel ${type} job ${id.slice(0, 8)}…?`)) return;
    setBusy(`${type}:${id}:cancel`);
    try { await api.pipelineCancel(type, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  const columns = useMemo<ColumnDef<QueueRow>[]>(() => [
    {
      id: 'type', accessorKey: 'type', enableSorting: true, enableColumnFilter: true,
      header: ({ column }) => (
        <HeaderCell
          label="Type"
          column={column}
          filter={<MultiSelect options={ALL_TYPES} value={(column.getFilterValue() as string[] | undefined) ?? []}
                                onChange={(v) => column.setFilterValue(v.length ? v : undefined)} />}
        />
      ),
      cell: ({ getValue }) => (
        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${typeBadge(getValue() as QueueJobType)}`}>
          {getValue() as string}
        </span>
      ),
    },
    {
      id: 'status', accessorKey: 'status', enableSorting: true, enableColumnFilter: true,
      header: ({ column }) => (
        <HeaderCell
          label="Status"
          column={column}
          filter={<MultiSelect options={ALL_STATUSES} value={(column.getFilterValue() as string[] | undefined) ?? []}
                                onChange={(v) => column.setFilterValue(v.length ? v : undefined)} />}
        />
      ),
      cell: ({ getValue }) => (
        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${statusBadge(getValue() as string)}`}>
          {getValue() as string}
        </span>
      ),
    },
    {
      id: 'target', enableSorting: false, enableColumnFilter: false,
      header: () => <span className="text-left">Target</span>,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-0">
            <div className="font-mono text-xs truncate">
              <span className="text-zinc-500">{r.projectSlug} / </span>
              {renderRowTargets(r, links[r.projectSlug])}
              {r.triggerToken && <span className="text-zinc-600 ml-2">→ {r.triggerToken}</span>}
            </div>
            {r.errorMessage && (
              <div className="text-xs text-red-400 truncate" title={r.errorMessage}>
                ⚠ {r.errorMessage}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'queuedAt', accessorKey: 'queuedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Queued" column={column} />,
      cell: ({ getValue }) => <span className="text-xs text-zinc-400 whitespace-nowrap">{fmt(getValue() as string | null)}</span>,
    },
    {
      id: 'startedAt', accessorKey: 'startedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Started" column={column} />,
      cell: ({ getValue }) => <span className="text-xs text-zinc-400 whitespace-nowrap">{fmt(getValue() as string | null) || '—'}</span>,
    },
    {
      id: 'completedAt', accessorKey: 'completedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Completed" column={column} />,
      cell: ({ getValue }) => <span className="text-xs text-zinc-400 whitespace-nowrap">{fmt(getValue() as string | null) || '—'}</span>,
    },
    {
      id: 'actions', enableSorting: false, enableColumnFilter: false,
      header: () => <span className="block text-right">Actions</span>,
      cell: ({ row }) => {
        const r = row.original;
        const isPending  = r.status === 'pending';
        const isTerminal = TERMINAL_STATUSES.has(r.status);
        const canCancel  = !isTerminal;
        // Reorder buttons appear for every pending row regardless of type. The
        // server pre-computes whether this row is the head or tail of the
        // unified pending FIFO and disables the matching direction.
        return (
          <div className="text-right whitespace-nowrap">
            {isPending && (
              <span className="inline-flex flex-col mr-2 align-middle">
                <button disabled={!!busy || r.isFirstPending} onClick={() => move(r.type, r.id, 'up')}
                        className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500 px-1 leading-none" title="Move up">↑</button>
                <button disabled={!!busy || r.isLastPending} onClick={() => move(r.type, r.id, 'down')}
                        className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500 px-1 leading-none" title="Move down">↓</button>
              </span>
            )}
            {canCancel && (
              <button onClick={() => cancel(r.type, r.id)}
                      disabled={busy === `${r.type}:${r.id}:cancel`}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-1 rounded disabled:opacity-50">
                {busy === `${r.type}:${r.id}:cancel` ? '…' : 'cancel'}
              </button>
            )}
          </div>
        );
      },
    },
  // links/busy/move/cancel captured by closure; deps intentionally narrow.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [links, busy]);

  const rows  = data?.rows  ?? [];
  const total = data?.total ?? 0;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, pagination },
    onSortingChange:        setSorting,
    onColumnFiltersChange:  setColumnFilters,
    onPaginationChange:     setPagination,
    manualSorting:    true,
    manualFiltering:  true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-4">
          <p className="text-red-200 font-mono text-sm">{error}</p>
        </div>
      )}

      {!data && !error && <p className="text-zinc-500">Loading…</p>}

      {data && (
        <div className="bg-zinc-900 border border-zinc-800 rounded overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-zinc-950 text-zinc-400 text-xs uppercase tracking-wider align-top">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="text-left px-3 py-2 font-normal">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-zinc-600 italic">
                    — no rows match these filters —
                  </td>
                </tr>
              )}
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className="px-3 py-2 align-top">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <div>
            {total === 0
              ? '0 rows'
              : `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} of ${total}`}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">
              Page size&nbsp;
              <select value={pagination.pageSize}
                      onChange={(e) => setPagination((p) => ({ ...p, pageSize: parseInt(e.target.value, 10), pageIndex: 0 }))}
                      className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200">
                {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button disabled={!table.getCanPreviousPage()} onClick={() => table.firstPage()}
                    className="px-2 py-1 border border-zinc-700 rounded disabled:opacity-30 hover:bg-zinc-800">«</button>
            <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}
                    className="px-2 py-1 border border-zinc-700 rounded disabled:opacity-30 hover:bg-zinc-800">‹</button>
            <span className="text-xs text-zinc-400">{pagination.pageIndex + 1} / {table.getPageCount()}</span>
            <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}
                    className="px-2 py-1 border border-zinc-700 rounded disabled:opacity-30 hover:bg-zinc-800">›</button>
            <button disabled={!table.getCanNextPage()} onClick={() => table.lastPage()}
                    className="px-2 py-1 border border-zinc-700 rounded disabled:opacity-30 hover:bg-zinc-800">»</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header cell with built-in sort toggle + optional filter dropdown ─────────

function HeaderCell({ label, column, filter }: {
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

function MultiSelect({ options, value, onChange }: {
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

function renderRowTargets(row: QueueRow, pl?: ProjectLinks): React.ReactNode {
  const cls = 'underline-offset-2 hover:underline hover:text-white';

  if (row.type === 'scene' || row.type === 'video' || row.type === 'video_upscale') {
    // For video_upscale the profileCode includes a "↑FHD" suffix — strip for lookup.
    const lookupCode = row.profileCode.replace(/\s*↑FHD\s*$/, '');
    const shot  = pl?.shots.get(lookupCode);
    const slug  = row.projectSlug;
    const sceneNode = shot
      ? <Link href={`/projects/${slug}/scenes#${shot.sceneKey}`} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
      : <span className="text-zinc-300">{row.characterCode}</span>;
    const shotNode = shot
      ? (row.type === 'video' || row.type === 'video_upscale'
          ? <Link href={`/projects/${slug}/shots/${shot.shotId}/videos/${row.id}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
          : <Link href={`/projects/${slug}/shots/${shot.shotId}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>)
      : <span className="text-zinc-200">{row.profileCode}</span>;
    return <>{sceneNode}<span className="text-zinc-500"> · </span>{shotNode}</>;
  }

  const char = pl?.chars.get(row.characterCode);
  const profileId = char?.profiles.get(row.profileCode);
  const slug = row.projectSlug;
  const charNode = profileId
    ? <Link href={`/projects/${slug}/characters/${profileId}`} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
    : <span className="text-zinc-300">{row.characterCode}</span>;
  const profNode = profileId
    ? <Link href={`/projects/${slug}/characters/${profileId}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
    : <span className="text-zinc-200">{row.profileCode}</span>;
  return <>{charNode}<span className="text-zinc-500"> · </span>{profNode}</>;
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const dt = now - d.getTime();
  // Negative dt = timestamp in "future" (server/client clock or TZ skew).
  if (dt < 0)             return 'just now';
  if (dt < 60_000)        return `${Math.floor(dt / 1000)}s ago`;
  if (dt < 3_600_000)     return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000)    return `${Math.floor(dt / 3_600_000)}h ago`;
  return d.toLocaleString();
}

function typeBadge(t: QueueJobType): string {
  if (t === 'training')      return 'bg-purple-950/40 text-purple-300 border-purple-900';
  if (t === 'dataset')       return 'bg-blue-950/40   text-blue-300   border-blue-900';
  if (t === 'scene')         return 'bg-amber-950/40  text-amber-300  border-amber-900';
  if (t === 'video')         return 'bg-rose-950/40   text-rose-300   border-rose-900';
  if (t === 'video_upscale') return 'bg-pink-950/40   text-pink-300   border-pink-900';
  if (t === 'tts')           return 'bg-cyan-950/40   text-cyan-300   border-cyan-900';
  return                            'bg-emerald-950/40 text-emerald-300 border-emerald-900';
}

function statusBadge(s: string): string {
  switch (s) {
    case 'pending':    return 'bg-zinc-800 text-zinc-400';
    case 'blocked':    return 'bg-amber-950 text-amber-400';
    case 'running':
    case 'preparing':
    case 'captioning':
    case 'training':   return 'bg-emerald-950 text-emerald-300';
    case 'completed':  return 'bg-emerald-900/40 text-emerald-400';
    case 'failed':     return 'bg-red-950 text-red-400';
    case 'cancelled':  return 'bg-zinc-800 text-zinc-500';
    default:           return 'bg-zinc-800 text-zinc-400';
  }
}
