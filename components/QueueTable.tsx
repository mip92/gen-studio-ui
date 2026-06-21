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
  ProjectListItem,
} from '../lib/api';
import { HeaderCell, MultiSelect, MultiSelectLabeled } from './table/TableControls';

const POLL_MS = 3000;

const ALL_TYPES: QueueJobType[] = ['training', 'dataset', 'scene', 'video', 'video_upscale', 'video_interp', 'tts', 'bgm', 'anchor'];
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
  /** Project slugs pre-selected in the Project column filter dropdown. */
  initialProjects?: string[];
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

  const typeFilter    = columnFilters.find((f) => f.id === 'type')?.value    as string[] | undefined;
  const statusFilter  = columnFilters.find((f) => f.id === 'status')?.value  as string[] | undefined;
  const projectFilter = columnFilters.find((f) => f.id === 'project')?.value as string[] | undefined;

  return {
    sort:    sortId,
    order,
    page:    pagination.pageIndex + 1,
    limit:   pagination.pageSize,
    type:    typeFilter    && typeFilter.length    > 0 ? (typeFilter    as QueueJobType[]) : undefined,
    status:  statusFilter  && statusFilter.length  > 0 ?  statusFilter                     : undefined,
    project: projectFilter && projectFilter.length > 0 ?  projectFilter                    : undefined,
  };
}

export default function QueueTable({
  initialSort     = { id: 'queuedAt', desc: true },
  initialStatuses = [],
  initialTypes    = [],
  initialProjects = [],
}: QueueTableProps) {
  const [sorting,    setSorting]    = useState<SortingState>([initialSort]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const init: ColumnFiltersState = [];
    if (initialStatuses.length > 0) init.push({ id: 'status',  value: initialStatuses });
    if (initialTypes.length    > 0) init.push({ id: 'type',    value: initialTypes });
    if (initialProjects.length > 0) init.push({ id: 'project', value: initialProjects });
    return init;
  });

  // Project list for the Project column's filter dropdown. Single fetch on
  // mount — the list rarely changes during a session and we don't want every
  // poll to re-request it. Empty array on fetch failure (filter still works,
  // just shows no options).
  const [projectList, setProjectList] = useState<ProjectListItem[]>([]);
  useEffect(() => {
    api.listProjects().then(setProjectList).catch(() => setProjectList([]));
  }, []);

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

  const move = async (type: QueueJobType, id: string, direction: 'up' | 'down' | 'top') => {
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
      id: 'project', accessorKey: 'projectSlug', enableSorting: true, enableColumnFilter: true,
      header: ({ column }) => (
        <HeaderCell
          label="Project"
          column={column}
          filter={
            <MultiSelectLabeled
              options={projectList.map((p) => ({ value: p.slug, label: p.name }))}
              value={(column.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
            />
          }
        />
      ),
      cell: ({ row }) => {
        const slug = row.original.projectSlug;
        const proj = projectList.find((p) => p.slug === slug);
        // Prefer the UUID from the row itself (always populated by the API);
        // fall back to a lookup, then to the slug.
        const id = row.original.projectId ?? proj?.id ?? slug;
        return (
          <Link href={`/projects/${id}`}
                className="text-xs text-zinc-300 hover:text-white underline-offset-2 hover:underline truncate inline-block max-w-[140px]"
                title={proj?.name ?? slug}>
            {proj?.name ?? slug}
          </Link>
        );
      },
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
              {renderRowTargets(r, links[r.projectSlug], projectList.find((p) => p.slug === r.projectSlug)?.id)}
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
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'startedAt', accessorKey: 'startedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Started" column={column} />,
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'completedAt', accessorKey: 'completedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Completed" column={column} />,
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'duration', enableSorting: false, enableColumnFilter: false,
      header: () => <span className="text-left">Duration</span>,
      cell: ({ row }) => {
        const r = row.original;
        if (!r.startedAt) return <span className="text-xs text-zinc-600">—</span>;
        const end = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
        const ms  = end - new Date(r.startedAt).getTime();
        const running = !r.completedAt;
        return (
          <span className={`text-xs font-mono whitespace-nowrap ${running ? 'text-amber-300' : 'text-zinc-300'}`}>
            {fmtDuration(ms)}{running && ' ↻'}
          </span>
        );
      },
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
            {/* Jump to the front of the pending queue (right behind the running
                job — a running job can never be preempted). Disabled when the row
                is already first in the FIFO, which also covers the lone-pending
                case (a single pending row is both first and last). */}
            {isPending && (
              <button disabled={!!busy || r.isFirstPending}
                      onClick={() => move(r.type, r.id, 'top')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-900/50 hover:border-emerald-700 px-2 py-1 rounded disabled:opacity-30 disabled:hover:border-emerald-900/50 mr-2"
                      title="Поднять в начало очереди (сразу после текущей задачи; выше запущенной поднять нельзя)">
                {busy === `${r.type}:${r.id}:top` ? '…' : '⤒ в начало'}
              </button>
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
  ], [links, busy, projectList]);

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

function renderRowTargets(row: QueueRow, pl?: ProjectLinks, projectId?: string): React.ReactNode {
  const cls = 'underline-offset-2 hover:underline hover:text-white';

  // Canonical URL form is always /projects/<uuid>/...; the row already carries
  // the UUID (`row.projectId`), so a slug fallback is only used when the API
  // is older than the projectId field.
  const projSeg = row.projectId ?? projectId ?? row.projectSlug;

  // Shot UUID. Backend now ships `shotId` directly for shot-anchored jobs
  // (scene render / video / video_upscale / shot-level TTS); the projectLinks
  // map lookup is the legacy fallback.
  const fallbackShotId = (() => {
    const lookupCode = row.profileCode.replace(/\s*↑FHD\s*$/, '').replace(/\s*⏩FPS\s*$/, '');
    return pl?.shots.get(lookupCode)?.shotId ?? null;
  })();
  const shotId  = row.shotId ?? fallbackShotId;
  const sceneInfo = (() => {
    const lookupCode = row.profileCode.replace(/\s*↑FHD\s*$/, '').replace(/\s*⏩FPS\s*$/, '');
    return pl?.shots.get(lookupCode) ?? null;
  })();

  // Map queue job type → the shot tab where the result is viewable.
  // scene  → /render   (image generation candidates land in the Сцена tab)
  // video  → /videos   (i2v output list)
  // tts    → /narration (per-shot voiceover)
  function shotTabHrefFor(type: QueueRow['type']): string | null {
    if (!shotId) return null;
    if (type === 'scene')         return `/projects/${projSeg}/shots/${shotId}/render`;
    if (type === 'video')         return `/projects/${projSeg}/shots/${shotId}/videos`;
    if (type === 'video_upscale') return `/projects/${projSeg}/shots/${shotId}/videos`;
    if (type === 'video_interp')  return `/projects/${projSeg}/shots/${shotId}/videos`;
    if (type === 'tts')           return `/projects/${projSeg}/shots/${shotId}/narration`;
    return null;
  }

  if (row.type === 'scene' || row.type === 'video' || row.type === 'video_upscale' || row.type === 'video_interp') {
    const sceneHref = sceneInfo ? `/projects/${projSeg}/scenes#${sceneInfo.sceneKey}` : null;
    const shotHref  = shotTabHrefFor(row.type);
    const sceneNode = sceneHref
      ? <Link href={sceneHref} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
      : <span className="text-zinc-300">{row.characterCode}</span>;
    const shotNode = shotHref
      ? <Link href={shotHref} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
      : <span className="text-zinc-200">{row.profileCode}</span>;
    return <>{sceneNode}<span className="text-zinc-500"> · </span>{shotNode}</>;
  }

  // Per-shot TTS row → link the profileCode (which is the shotCode) to the
  // shot's narration tab. Scene-level TTS rows (no shotId) fall through to
  // a plain label since the project's /scenes anchor already exists from the
  // scene-cell column.
  if (row.type === 'tts' && shotId) {
    const shotHref = shotTabHrefFor('tts')!;
    return (
      <>
        <span className="text-zinc-300">{row.characterCode}</span>
        <span className="text-zinc-500"> · </span>
        <Link href={shotHref} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
      </>
    );
  }

  const char = pl?.chars.get(row.characterCode);
  const profileId = char?.profiles.get(row.profileCode);
  // Persona pages are project-independent now — always link to the global
  // /characters/<profileId>/description, not the legacy project-scoped URL.
  const charNode = profileId
    ? <Link href={`/characters/${profileId}/description`} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
    : <span className="text-zinc-300">{row.characterCode}</span>;
  const profNode = profileId
    ? <Link href={`/characters/${profileId}/description`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
    : <span className="text-zinc-200">{row.profileCode}</span>;
  return <>{charNode}<span className="text-zinc-500"> · </span>{profNode}</>;
}

function TimeCell({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-xs text-zinc-600">—</span>;
  return (
    <div className="leading-tight" title={iso}>
      <div className="text-xs text-zinc-300 font-mono whitespace-nowrap">{fmtAbs(iso)}</div>
      <div className="text-[10px] text-zinc-500 whitespace-nowrap">{fmtRel(iso)}</div>
    </div>
  );
}

function fmtAbs(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}:${ss}`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtRel(iso: string | null): string {
  if (!iso) return '';
  const dt = Date.now() - new Date(iso).getTime();
  if (dt < 0)             return 'just now';
  if (dt < 60_000)        return `${Math.floor(dt / 1000)}s ago`;
  if (dt < 3_600_000)     return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000)    return `${Math.floor(dt / 3_600_000)}h ago`;
  return `${Math.floor(dt / 86_400_000)}d ago`;
}
function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function typeBadge(t: QueueJobType): string {
  if (t === 'training')      return 'bg-purple-950/40 text-purple-300 border-purple-900';
  if (t === 'dataset')       return 'bg-blue-950/40   text-blue-300   border-blue-900';
  if (t === 'scene')         return 'bg-amber-950/40  text-amber-300  border-amber-900';
  if (t === 'video')         return 'bg-rose-950/40   text-rose-300   border-rose-900';
  if (t === 'video_upscale') return 'bg-pink-950/40   text-pink-300   border-pink-900';
  if (t === 'video_interp')  return 'bg-orange-950/40 text-orange-300 border-orange-900';
  if (t === 'tts')           return 'bg-cyan-950/40   text-cyan-300   border-cyan-900';
  if (t === 'anchor')        return 'bg-fuchsia-950/40 text-fuchsia-300 border-fuchsia-900';
  return                            'bg-emerald-950/40 text-emerald-300 border-emerald-900';  // bgm
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
