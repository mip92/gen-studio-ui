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
  type VisibilityState,
} from '@tanstack/react-table';
import {
  api,
  QueueListResponse,
  QueueRow,
  QueueJobType,
  QueueSortField,
  ProjectListItem,
  isProjectArchived,
} from '../lib/api';
import { HeaderCell, MultiSelect, MultiSelectLabeled } from './table/TableControls';

const POLL_MS = 3000;

const ALL_TYPES: QueueJobType[] = ['training', 'dataset', 'scene', 'video', 'video_post', 'tts', 'bgm', 'anchor', 'validation', 'anchor_validation', 'caption', 'thumbnail', 'thumbnail_ideas'];
// The ledger has one status vocabulary for every job type; the old per-table
// values (blocked / preparing / captioning / training) no longer reach the queue.
const ALL_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped'];
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'skipped']);

/** Only character profiles still need a lookup: shot-anchored rows carry their
 *  own project/scene/shot ids in the queue entry's snapshot. */
type ProjectLinks = {
  chars: Map<string, { characterId: string; profiles: Map<string, string> }>;
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
  /** Column ids to hide. The Active view drops the timing columns: pending rows
   *  have nothing to put in them, so they are three columns of dashes. */
  hiddenColumns?:   string[];
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
  initialSort     = { id: 'queue', desc: false },
  initialStatuses = [],
  initialTypes    = [],
  initialProjects = [],
  hiddenColumns   = [],
}: QueueTableProps) {
  const [sorting,    setSorting]    = useState<SortingState>([initialSort]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => Object.fromEntries(hiddenColumns.map((id) => [id, false])),
  );
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
    for (const r of data.rows) if (r.projectSlug) slugs.add(r.projectSlug);

    for (const slug of slugs) {
      if (links[slug] || inflightSlugs.current.has(slug)) continue;
      inflightSlugs.current.add(slug);
      void api.listCharacters(slug)
        .then((chars) => {
          const charMap: ProjectLinks['chars'] = new Map();
          for (const c of chars) {
            const profileMap = new Map<string, string>();
            for (const p of c.profiles) profileMap.set(p.profileCode, p.id);
            charMap.set(c.code, { characterId: c.id, profiles: profileMap });
          }
          setLinks((prev) => ({ ...prev, [slug]: { chars: charMap } }));
        })
        .catch(() => { /* leave links unset */ })
        .finally(() => { inflightSlugs.current.delete(slug); });
    }
  }, [data, links]);

  /** Reorder step. A refused move reports why instead of silently doing nothing. */
  const move = async (entryId: string, direction: 'up' | 'down' | 'top') => {
    setBusy(`${entryId}:${direction}`);
    try {
      const res = await api.pipelineMove(entryId, direction);
      if (!res.moved && res.reason === 'tier-boundary') {
        setError('Соседняя задача принадлежит приоритетному проекту — порядок задаёт приоритет, а не позиция. Сначала снимите приоритет.');
      }
      await refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  /** Drop the dragged row immediately before `beforeEntryId` (null = to the end). */
  const moveTo = async (entryId: string, beforeEntryId: string | null) => {
    setBusy(`${entryId}:drag`);
    try {
      const res = await api.pipelineMoveTo(entryId, beforeEntryId);
      if (!res.moved && res.reason === 'tier-boundary') {
        setError('Нельзя перетащить через границу приоритета проекта — сначала снимите приоритет.');
      }
      await refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  /** Raise (or clear) the whole project's priority. Sticky: future jobs inherit it. */
  const prioritizeProject = async (projectId: string, tier: number) => {
    setBusy(`proj:${projectId}`);
    try { await api.pipelinePrioritizeProject(projectId, tier); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  const cancel = async (r: QueueRow) => {
    if (!confirm(`Cancel ${r.type} — ${r.label}?`)) return;
    setBusy(`${r.entryId}:cancel`);
    try { await api.pipelineCancel(r.entryId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  const columns = useMemo<ColumnDef<QueueRow>[]>(() => [
    {
      // id is `queue` so sorting by it asks the API for true dispatch order.
      // The accessor is what makes the header clickable at all: TanStack refuses
      // to sort a column that has none, however it is configured.
      id: 'queue', accessorFn: (r) => r.position ?? Number.MAX_SAFE_INTEGER,
      enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="#" column={column} />,
      cell: ({ row }) => {
        const r = row.original;
        if (r.status === 'running') return <span className="text-xs text-amber-300 font-mono">▶</span>;
        if (r.position === null)    return <span className="text-xs text-zinc-700">—</span>;
        return (
          <span className="text-xs font-mono text-zinc-400 whitespace-nowrap" title="Перетащите строку, чтобы поменять место">
            <span className="text-zinc-600 mr-1 cursor-grab">⠿</span>{r.position}
            {r.projectTier > 0 && <span className="ml-1 text-emerald-400" title="Проект приоритетный">⚑</span>}
          </span>
        );
      },
    },
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
              // Archived (published) projects no longer need queue filtering;
              // the full projectList stays intact for row name/link lookups.
              options={projectList
                .filter((p) => !isProjectArchived(p))
                .map((p) => ({ value: p.slug, label: p.name }))}
              value={(column.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
            />
          }
        />
      ),
      cell: ({ row }) => {
        const slug = row.original.projectSlug;
        const proj = slug ? projectList.find((p) => p.slug === slug) : undefined;
        // Prefer the UUID carried by the row; fall back to a lookup, then the
        // slug. A few job types (library-character work) have no project at all.
        const id = row.original.projectId ?? proj?.id ?? slug;
        if (!id) return <span className="text-xs text-zinc-600">—</span>;
        return (
          <Link href={`/projects/${id}`}
                className="text-xs text-zinc-300 hover:text-white underline-offset-2 hover:underline truncate inline-block max-w-[140px]"
                title={proj?.name ?? slug ?? undefined}>
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
              {renderRowTargets(r, r.projectSlug ? links[r.projectSlug] : undefined)}
              {r.attemptNumber > 1 && (
                <span className="text-amber-500 ml-2" title="Повторная попытка на той же строке">#{r.attemptNumber}</span>
              )}
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
      id: 'duration', accessorKey: 'durationMs', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Duration" column={column} />,
      cell: ({ row }) => {
        const r = row.original;
        // The server measures this once at close time (and reports live elapsed
        // time while running), so the number here is the same one the film's
        // statistics are billed from.
        if (r.durationMs === null) return <span className="text-xs text-zinc-600">—</span>;
        const running = !r.completedAt;
        return (
          <span className={`text-xs font-mono whitespace-nowrap ${running ? 'text-amber-300' : 'text-zinc-300'}`}>
            {fmtDuration(r.durationMs)}{running && ' ↻'}
            {r.outcome === 'wasted' && (
              <span className="ml-1 text-red-400" title={`Впустую: ${r.outcomeReason ?? ''}`}>✗</span>
            )}
            {r.outcome === 'useful' && <span className="ml-1 text-emerald-500" title="В финальной версии">✓</span>}
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
                <button disabled={!!busy || r.isFirstPending} onClick={() => move(r.entryId, 'up')}
                        className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500 px-1 leading-none" title="Move up">↑</button>
                <button disabled={!!busy || r.isLastPending} onClick={() => move(r.entryId, 'down')}
                        className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 disabled:hover:text-zinc-500 px-1 leading-none" title="Move down">↓</button>
              </span>
            )}
            {/* Front of the pending queue. A running job is never preempted, so
                "first" means "next to run". */}
            {isPending && (
              <button disabled={!!busy || r.isFirstPending}
                      onClick={() => move(r.entryId, 'top')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-900/50 hover:border-emerald-700 px-2 py-1 rounded disabled:opacity-30 disabled:hover:border-emerald-900/50 mr-2"
                      title="Поднять в начало очереди (сразу после текущей задачи)">
                {busy === `${r.entryId}:top` ? '…' : '⤒ в начало'}
              </button>
            )}
            {/* Whole-film priority. Sticky, so shots queued later jump too. */}
            {isPending && r.projectId && (
              <button disabled={!!busy}
                      onClick={() => prioritizeProject(r.projectId!, r.projectTier > 0 ? 0 : 1)}
                      className={`text-xs px-2 py-1 rounded border mr-2 disabled:opacity-30 ${
                        r.projectTier > 0
                          ? 'text-emerald-300 border-emerald-700 hover:border-emerald-500'
                          : 'text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'}`}
                      title={r.projectTier > 0
                        ? 'Снять приоритет проекта'
                        : 'Весь проект вперёд: все его задачи, включая будущие, идут раньше остальных'}>
                {busy === `proj:${r.projectId}` ? '…' : (r.projectTier > 0 ? '⚑ проект' : '⚐ проект')}
              </button>
            )}
            {canCancel && (
              <button onClick={() => cancel(r)}
                      disabled={busy === `${r.entryId}:cancel`}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-1 rounded disabled:opacity-50">
                {busy === `${r.entryId}:cancel` ? '…' : 'cancel'}
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

  // Native HTML5 drag & drop — no extra dependency for what is one row move.
  // Only pending rows participate: a running job cannot be preempted and a
  // finished one has no position to change.
  const [dragId, setDragId]   = useState<string | null>(null);
  const [dropId, setDropId]   = useState<string | null>(null);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, pagination, columnVisibility },
    onSortingChange:          setSorting,
    onColumnFiltersChange:    setColumnFilters,
    onPaginationChange:       setPagination,
    onColumnVisibilityChange: setColumnVisibility,
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
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-8 text-center text-zinc-600 italic">
                    — no rows match these filters —
                  </td>
                </tr>
              )}
              {table.getRowModel().rows.map((r) => {
                const row       = r.original;
                const draggable = row.status === 'pending';
                const isDragged = dragId === row.entryId;
                const isTarget  = dropId === row.entryId && dragId !== row.entryId;
                return (
                  <tr key={r.id}
                      draggable={draggable}
                      onDragStart={() => setDragId(row.entryId)}
                      onDragEnd={() => { setDragId(null); setDropId(null); }}
                      onDragOver={(e) => {
                        if (!dragId || !draggable) return;
                        e.preventDefault();                 // required to allow a drop
                        if (dropId !== row.entryId) setDropId(row.entryId);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dragged = dragId;
                        setDragId(null);
                        setDropId(null);
                        // Dropping onto a row means "take this row's place",
                        // i.e. land immediately before it.
                        if (dragged && dragged !== row.entryId) void moveTo(dragged, row.entryId);
                      }}
                      className={`hover:bg-zinc-900/50 ${draggable ? 'cursor-grab' : ''} ${
                        isDragged ? 'opacity-40' : ''} ${
                        isTarget  ? 'border-t-2 border-t-emerald-500' : ''}`}>
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className="px-3 py-2 align-top">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
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

function renderRowTargets(row: QueueRow, pl?: ProjectLinks): React.ReactNode {
  const cls = 'underline-offset-2 hover:underline hover:text-white';

  // Every id needed for a deep link is already on the row: the queue entry keeps
  // a denormalised snapshot of its project, scene and shot, so no lookup table is
  // consulted for shot-anchored work any more (and the link still resolves even
  // after the shot itself is deleted, which is the point of the snapshot).
  const projSeg = row.projectId ?? row.projectSlug;
  const shotId  = row.shotId;

  // Map job type -> the shot tab where its result is viewable.
  function shotTabHref(): string | null {
    if (!shotId || !projSeg) return null;
    if (row.type === 'scene')      return `/projects/${projSeg}/shots/${shotId}/render`;
    if (row.type === 'video')      return `/projects/${projSeg}/shots/${shotId}/videos`;
    if (row.type === 'video_post') return `/projects/${projSeg}/shots/${shotId}/videos`;
    if (row.type === 'tts')        return `/projects/${projSeg}/shots/${shotId}/narration`;
    if (row.type === 'validation') return `/projects/${projSeg}/shots/${shotId}/render`;
    return null;
  }

  if (shotId) {
    // `context` carries the scene key for shot-anchored jobs.
    const sceneHref = row.context && projSeg ? `/projects/${projSeg}/scenes#${row.context}` : null;
    const shotHref  = shotTabHref();
    const sceneNode = sceneHref
      ? <Link href={sceneHref} className={`text-zinc-300 ${cls}`}>{row.context}</Link>
      : <span className="text-zinc-300">{row.context ?? '—'}</span>;
    const shotNode = shotHref
      ? <Link href={shotHref} className={`text-zinc-200 ${cls}`}>{row.label}</Link>
      : <span className="text-zinc-200">{row.label}</span>;
    return <>{sceneNode}<span className="text-zinc-500"> · </span>{shotNode}</>;
  }

  // Profile-scoped work (anchors, datasets, LoRA training, anchor QC): the
  // characters map is still the only way to turn a code into a profile id.
  if (row.profileCode) {
    const char      = row.context ? pl?.chars.get(row.context) : undefined;
    const profileId = char?.profiles.get(row.profileCode.replace(/^[^A-Za-z0-9]+/u, '').trim());
    const charNode = profileId
      ? <Link href={`/characters/${profileId}/description`} className={`text-zinc-300 ${cls}`}>{row.context}</Link>
      : <span className="text-zinc-300">{row.context ?? '—'}</span>;
    const profNode = profileId
      ? <Link href={`/characters/${profileId}/description`} className={`text-zinc-200 ${cls}`}>{row.label}</Link>
      : <span className="text-zinc-200">{row.label}</span>;
    return <>{charNode}<span className="text-zinc-500"> · </span>{profNode}</>;
  }

  // Cover work is project-scoped, not shot- or profile-scoped: both the art
  // renders and the model's idea rounds land on the project's Обложка tab.
  if ((row.type === 'thumbnail' || row.type === 'thumbnail_ideas') && projSeg) {
    return (
      <Link href={`/projects/${projSeg}/thumbnail`} className={`text-zinc-200 ${cls}`}>
        {row.label}
      </Link>
    );
  }

  // Scene-level narration, music, subtitles: label alone says it.
  return (
    <>
      {row.context && <><span className="text-zinc-300">{row.context}</span><span className="text-zinc-500"> · </span></>}
      <span className="text-zinc-200">{row.label}</span>
    </>
  );
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
  if (t === 'video_post')    return 'bg-pink-950/40   text-pink-300   border-pink-900';
  if (t === 'tts')           return 'bg-cyan-950/40   text-cyan-300   border-cyan-900';
  if (t === 'anchor')        return 'bg-fuchsia-950/40 text-fuchsia-300 border-fuchsia-900';
  if (t === 'validation')    return 'bg-indigo-950/40 text-indigo-300 border-indigo-900';
  if (t === 'anchor_validation') return 'bg-violet-950/40 text-violet-300 border-violet-900';
  if (t === 'caption')       return 'bg-teal-950/40   text-teal-300   border-teal-900';
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
    case 'skipped':    return 'bg-zinc-800 text-zinc-600';
    default:           return 'bg-zinc-800 text-zinc-400';
  }
}
