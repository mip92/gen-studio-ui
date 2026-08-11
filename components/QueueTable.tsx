'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type PaginationState,
  type Updater,
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
import { diffQueueUrlState, parseQueueUrlState, type QueuePreset } from '../lib/queueUrlState';
import { FilterField, HeaderCell, MultiSelectLabeled } from './table/TableControls';

const POLL_MS = 3000;

const ALL_TYPES: QueueJobType[] = ['training', 'dataset', 'scene', 'video', 'video_post', 'tts', 'bgm', 'anchor', 'validation', 'anchor_validation', 'caption', 'thumbnail', 'thumbnail_ideas', 'prop_anchor', 'vo_validation', 'image_qc', 'video_qc'];
// Historical ledger value 'scene' actually means "render one shot's still image"
// (SceneRenderJob predates the act/shot vocabulary). The API values stay as is;
// the UI shows Russian labels (user 2026-08-07: «давай на русском все») — and
// 'scene' is shown as «кадр img» so the badge doesn't lie about the entity.
const TYPE_LABELS: Partial<Record<QueueJobType, string>> = {
  training: 'тренировка', dataset: 'датасет', scene: 'кадр img', video: 'видео',
  video_post: 'fhd+fps', tts: 'озвучка', bgm: 'музыка', anchor: 'якорь',
  validation: 'валидация', anchor_validation: 'якорь qc', caption: 'капшн',
  thumbnail: 'обложка', thumbnail_ideas: 'идеи обложки', prop_anchor: 'якорь предм.',
  vo_validation: 'озвучка qc', image_qc: 'кадр qc', video_qc: 'видео qc',
};
const typeLabel = (t: QueueJobType): string => TYPE_LABELS[t] ?? t;
// The ledger has one status vocabulary for every job type; the old per-table
// values (blocked / preparing / captioning / training) no longer reach the queue.
const ALL_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped'];
// Display-only: API/filter values stay English, badges and dropdowns show these.
const STATUS_LABELS: Record<string, string> = {
  pending: 'ждёт', running: 'идёт', completed: 'готово',
  failed: 'ошибка', cancelled: 'отменено', skipped: 'пропущено',
};
const statusLabel = (s: string): string => STATUS_LABELS[s] ?? s;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'skipped']);

// Sort options for the phone layout. The desktop table sorts by tapping a column
// header, which the card list has none of — so the same eight sortable columns
// are offered here as a plain <select>. Keep in sync with the `id`s of the
// sortable columns below.
const SORT_LABELS: Record<QueueSortField, string> = {
  queue:       'Очередь',
  type:        'Тип',
  project:     'Проект',
  status:      'Статус',
  queuedAt:    'Добавлена',
  startedAt:   'Начата',
  completedAt: 'Завершена',
  duration:    'Длительность',
};

/** Only character profiles still need a lookup: shot-anchored rows carry their
 *  own project/scene/shot ids in the queue entry's snapshot. */
type ProjectLinks = {
  chars: Map<string, { characterId: string; profiles: Map<string, string> }>;
};

export interface QueueTableProps {
  /** Sort this tab opens with. A `sort`/`order` pair in the URL overrides it. */
  initialSort?:     { id: QueueSortField; desc: boolean };
  /** Statuses pre-selected in the Status column filter dropdown. The user can
   *  freely add or remove values from there — this is just a starting set,
   *  overridden by `?status=` in the URL. */
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

// useSearchParams() requires a Suspense boundary in a statically-rendered client
// page (Next 16) or the production build bails out. Wrapping here — rather than
// in each of the three /queue/* pages — keeps those files unchanged.
export default function QueueTable(props: QueueTableProps) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Загрузка…</p>}>
      <QueueTableInner {...props} />
    </Suspense>
  );
}

function QueueTableInner({
  initialSort     = { id: 'queue', desc: false },
  initialStatuses = [],
  initialTypes    = [],
  initialProjects = [],
  hiddenColumns   = [],
}: QueueTableProps) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // ── Filters / sort / page live in the URL, so a view is shareable ──────────
  // The tab's props are the DEFAULT; any param present in the URL wins. State is
  // derived on every render (no useState mirror, same as /actions) — that is what
  // rules out the replace()->render->replace() loop a syncing effect would create.
  // Keyed by content, not identity: the tab pages pass array literals, so a
  // dependency on the arrays themselves would rebuild the preset — and with it
  // every derived value below — on each render. Same trick as `refresh` uses.
  const presetKey = `${initialSort.id}|${initialSort.desc}|${initialStatuses.join(',')}|${initialTypes.join(',')}|${initialProjects.join(',')}`;
  const preset = useMemo<QueuePreset>(() => ({
    sort:     initialSort.id,
    desc:     initialSort.desc,
    statuses: initialStatuses,
    types:    initialTypes,
    projects: initialProjects,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [presetKey]);

  const { sorting, columnFilters, pagination } = useMemo(
    () => parseQueueUrlState(new URLSearchParams(searchParams.toString()), preset),
    [searchParams, preset],
  );

  // Not in the URL: nothing in this table can toggle column visibility, so there
  // is no user choice to make shareable. It stays a per-tab prop.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => Object.fromEntries(hiddenColumns.map((id) => [id, false])),
  );

  /** Merge a partial param update into the URL. replace(), not push(): sort
   *  clicks and pager taps are frequent and would otherwise fill the history
   *  stack, making the back button useless (same reasoning as /actions). */
  const pushQueueParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      // '' is a value here (a deliberately cleared filter), only null deletes.
      if (v === null) params.delete(k);
      else            params.set(k, v);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  // TanStack hands us either a value or an updater fn; funnel both through the
  // URL so header clicks, filter dropdowns and the pager all end up there.
  const onSortingChange = useCallback((u: Updater<SortingState>) => {
    pushQueueParams(diffQueueUrlState(
      { sorting: functionalUpdate(u, sorting), columnFilters, pagination }, preset));
  }, [sorting, columnFilters, pagination, preset, pushQueueParams]);

  const onColumnFiltersChange = useCallback((u: Updater<ColumnFiltersState>) => {
    pushQueueParams(diffQueueUrlState(
      // A narrower filter can leave the current page past the end of the result
      // set, so retreat to page 1 whenever the filters change.
      { sorting, columnFilters: functionalUpdate(u, columnFilters), pagination: { ...pagination, pageIndex: 0 } },
      preset));
  }, [sorting, columnFilters, pagination, preset, pushQueueParams]);

  const onPaginationChange = useCallback((u: Updater<PaginationState>) => {
    pushQueueParams(diffQueueUrlState(
      { sorting, columnFilters, pagination: functionalUpdate(u, pagination) }, preset));
  }, [sorting, columnFilters, pagination, preset, pushQueueParams]);

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
        setError('Бэкенд отдаёт старый формат очереди — перезапустите gen-studio, чтобы включился новый /pipeline/queue.');
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

  // Pull the page back inside the result set. The page number now lives in the
  // URL, so it survives what used to reset it: the queue draining under an open
  // deep page (this polls every 3s while jobs finish), a bookmark opened days
  // later, or a tab switch. Left uncorrected the table asks for a page that no
  // longer exists and renders "201–30 из 30" over an empty body. Runs only when
  // the fetched total proves the page is out of range, so it cannot ping-pong.
  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, Math.ceil(data.total / pagination.pageSize));
    if (pagination.pageIndex + 1 > lastPage) {
      pushQueueParams({ page: lastPage > 1 ? String(lastPage) : null });
    }
  }, [data, pagination.pageIndex, pagination.pageSize, pushQueueParams]);

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
    if (!confirm(`Отменить ${typeLabel(r.type)} — ${r.label}?`)) return;
    setBusy(`${r.entryId}:cancel`);
    try { await api.pipelineCancel(r.entryId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  /**
   * The per-row controls — reorder, whole-project priority, cancel — rendered
   * once and used by BOTH layouts: the desktop table's «Действия» column and
   * the phone card list. Sharing them is the point: the card list is the only
   * way to work the queue on a phone, so it must never end up with fewer
   * buttons than the table.
   */
  const rowActions = (r: QueueRow) => {
    const isPending  = r.status === 'pending';
    const canCancel  = !TERMINAL_STATUSES.has(r.status);
    const step = 'text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2.5 py-1 disabled:opacity-25 disabled:hover:text-zinc-400';
    return (
      <>
        {isPending && (
          <>
            <button disabled={!!busy || r.isFirstPending} onClick={() => move(r.entryId, 'up')}
                    className={step} title="Выше">↑</button>
            <button disabled={!!busy || r.isLastPending} onClick={() => move(r.entryId, 'down')}
                    className={step} title="Ниже">↓</button>
            {/* Front of the pending queue. A running job is never preempted, so
                "first" means "next to run". */}
            <button disabled={!!busy || r.isFirstPending} onClick={() => move(r.entryId, 'top')}
                    className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-900/50 hover:border-emerald-700 px-2.5 py-1 rounded disabled:opacity-30 disabled:hover:border-emerald-900/50"
                    title="Поднять в начало очереди (сразу после текущей задачи)">
              {busy === `${r.entryId}:top` ? '…' : '⤒ в начало'}
            </button>
          </>
        )}
        {/* Whole-film priority. Sticky, so shots queued later jump too. */}
        {isPending && r.projectId && (
          <button disabled={!!busy}
                  onClick={() => prioritizeProject(r.projectId!, r.projectTier > 0 ? 0 : 1)}
                  className={`text-xs px-2.5 py-1 rounded border disabled:opacity-30 ${
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
                  className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2.5 py-1 rounded disabled:opacity-50">
            {busy === `${r.entryId}:cancel` ? '…' : 'отменить'}
          </button>
        )}
      </>
    );
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
          label="Тип"
          column={column}
          filter={<MultiSelectLabeled options={ALL_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
                                value={(column.getFilterValue() as string[] | undefined) ?? []}
                                onChange={(v) => column.setFilterValue(v.length ? v : undefined)} />}
        />
      ),
      cell: ({ getValue }) => (
        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${typeBadge(getValue() as QueueJobType)}`}>
          {typeLabel(getValue() as QueueJobType)}
        </span>
      ),
    },
    {
      id: 'project', accessorKey: 'projectSlug', enableSorting: true, enableColumnFilter: true,
      header: ({ column }) => (
        <HeaderCell
          label="Проект"
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
          label="Статус"
          column={column}
          filter={<MultiSelectLabeled options={ALL_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
                                value={(column.getFilterValue() as string[] | undefined) ?? []}
                                onChange={(v) => column.setFilterValue(v.length ? v : undefined)} />}
        />
      ),
      cell: ({ getValue }) => (
        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${statusBadge(getValue() as string)}`}>
          {statusLabel(getValue() as string)}
        </span>
      ),
    },
    {
      id: 'target', enableSorting: false, enableColumnFilter: false,
      header: () => <span className="text-left">Цель</span>,
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
      header: ({ column }) => <HeaderCell label="Добавлена" column={column} />,
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'startedAt', accessorKey: 'startedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Начата" column={column} />,
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'completedAt', accessorKey: 'completedAt', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Завершена" column={column} />,
      cell: ({ getValue }) => <TimeCell iso={getValue() as string | null} />,
    },
    {
      id: 'duration', accessorKey: 'durationMs', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Длительность" column={column} />,
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
      header: () => <span className="block text-right">Действия</span>,
      // Reorder buttons appear for every pending row regardless of type. The
      // server pre-computes whether this row is the head or tail of the unified
      // pending FIFO and disables the matching direction.
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {rowActions(row.original)}
        </div>
      ),
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
    onSortingChange,
    onColumnFiltersChange,
    onPaginationChange,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting:    true,
    manualFiltering:  true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    getCoreRowModel: getCoreRowModel(),
  });

  const sortId   = (sorting[0]?.id as QueueSortField | undefined) ?? 'queue';
  const sortDesc = sorting[0]?.desc ?? true;

  const pager = data ? (
    <Pager
      pagination={pagination}
      total={total}
      pageCount={table.getPageCount()}
      canPrev={table.getCanPreviousPage()}
      canNext={table.getCanNextPage()}
      onFirst={() => table.firstPage()}
      onPrev={()  => table.previousPage()}
      onNext={()  => table.nextPage()}
      onLast={()  => table.lastPage()}
      onPageSize={(n) => onPaginationChange({ pageIndex: 0, pageSize: n })}
    />
  ) : null;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-4">
          <p className="text-red-200 font-mono text-sm">{error}</p>
        </div>
      )}

      {!data && !error && <p className="text-zinc-500">Загрузка…</p>}

      {/* Phone-only filter/sort bar. On desktop these live in the table's column
          headers, which the card list below doesn't have — without this bar a
          phone could neither filter nor sort the queue at all. */}
      {data && (
        <div className="md:hidden bg-zinc-900 border border-zinc-800 rounded p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <FilterField label="Тип">
            <MultiSelectLabeled
              options={ALL_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
              value={(table.getColumn('type')?.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => table.getColumn('type')?.setFilterValue(v.length ? v : undefined)}
            />
          </FilterField>
          <FilterField label="Проект">
            <MultiSelectLabeled
              options={projectList.filter((p) => !isProjectArchived(p)).map((p) => ({ value: p.slug, label: p.name }))}
              value={(table.getColumn('project')?.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => table.getColumn('project')?.setFilterValue(v.length ? v : undefined)}
            />
          </FilterField>
          <FilterField label="Статус">
            <MultiSelectLabeled
              options={ALL_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
              value={(table.getColumn('status')?.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => table.getColumn('status')?.setFilterValue(v.length ? v : undefined)}
            />
          </FilterField>
          <FilterField label="Сорт.">
            <div className="flex items-center gap-1">
              <select
                value={sortId}
                onChange={(e) => onSortingChange([{ id: e.target.value, desc: sortDesc }])}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              >
                {(Object.keys(SORT_LABELS) as QueueSortField[]).map((f) => (
                  <option key={f} value={f}>{SORT_LABELS[f]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onSortingChange([{ id: sortId, desc: !sortDesc }])}
                className="px-2.5 py-1 border border-zinc-700 rounded text-zinc-300"
                title={sortDesc ? 'По убыванию — нажми для возрастания' : 'По возрастанию — нажми для убывания'}
              >
                {sortDesc ? '↓' : '↑'}
              </button>
            </div>
          </FilterField>
        </div>
      )}

      {/* The pager is repeated above the rows as well as below. A page holds up
          to 200 of them, and on a phone that is a very long way to scroll back
          for a «следующая страница» tap. */}
      {pager}

      {/* Phone layout: one card per job. The desktop table is 960px of ten
          columns — on a 375px screen that is a horizontal-scrolling puzzle where
          the buttons sit past the right edge, so below md the table is replaced
          outright rather than squeezed. */}
      {data && (
        <div className="md:hidden space-y-2">
          {rows.length === 0 && (
            <p className="text-center text-zinc-600 italic py-6">— под эти фильтры не попала ни одна строка —</p>
          )}
          {rows.map((r) => {
            const proj = r.projectSlug ? projectList.find((p) => p.slug === r.projectSlug) : undefined;
            const projId = r.projectId ?? proj?.id ?? r.projectSlug;
            return (
              <article key={r.entryId} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.status === 'running'
                    ? <span className="text-xs text-amber-300 font-mono">▶</span>
                    : r.position !== null && (
                      <span className="text-xs font-mono text-zinc-400">
                        #{r.position}
                        {r.projectTier > 0 && <span className="ml-1 text-emerald-400" title="Проект приоритетный">⚑</span>}
                      </span>
                    )}
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${typeBadge(r.type)}`}>
                    {typeLabel(r.type)}
                  </span>
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${statusBadge(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.attemptNumber > 1 && (
                    <span className="text-[10px] text-amber-500" title="Повторная попытка на той же строке">#{r.attemptNumber}</span>
                  )}
                </div>

                <div className="font-mono text-sm break-words">
                  {renderRowTargets(r, r.projectSlug ? links[r.projectSlug] : undefined)}
                </div>

                {r.errorMessage && (
                  <div className="text-xs text-red-400 break-words">⚠ {r.errorMessage}</div>
                )}

                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                  {projId && (
                    <Link href={`/projects/${projId}`} className="text-zinc-400 underline-offset-2 hover:underline">
                      {proj?.name ?? r.projectSlug}
                    </Link>
                  )}
                  {r.queuedAt    && <span>добавлена {fmtRel(r.queuedAt)}</span>}
                  {r.durationMs !== null && (
                    <span className={!r.completedAt ? 'text-amber-300' : undefined}>
                      {fmtDuration(r.durationMs)}{!r.completedAt && ' ↻'}
                      {r.outcome === 'wasted' && <span className="ml-1 text-red-400" title={`Впустую: ${r.outcomeReason ?? ''}`}>✗</span>}
                      {r.outcome === 'useful' && <span className="ml-1 text-emerald-500" title="В финальной версии">✓</span>}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">{rowActions(r)}</div>
              </article>
            );
          })}
        </div>
      )}

      {data && (
        <div className="hidden md:block bg-zinc-900 border border-zinc-800 rounded overflow-x-auto">
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
                    — под эти фильтры не попала ни одна строка —
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

      {pager}
    </div>
  );
}

/**
 * Page controls, rendered both above and below the rows.
 *
 * flex-wrap is load-bearing: on a phone the row-count text plus the controls are
 * wider than the screen, and the page column clips horizontal overflow — without
 * the wrap the buttons ended up past the right edge, reachable only by
 * pinch-zooming out. The buttons carry real padding (not px-2 py-1) because they
 * are the most-tapped thing on the page.
 */
function Pager({
  pagination, total, pageCount, canPrev, canNext, onFirst, onPrev, onNext, onLast, onPageSize,
}: {
  pagination: PaginationState;
  total:      number;
  pageCount:  number;
  canPrev:    boolean;
  canNext:    boolean;
  onFirst:    () => void;
  onPrev:     () => void;
  onNext:     () => void;
  onLast:     () => void;
  onPageSize: (n: number) => void;
}) {
  const btn = 'px-3 py-1.5 border border-zinc-700 rounded text-zinc-200 disabled:opacity-30 hover:bg-zinc-800';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-zinc-400">
      <div>
        {total === 0
          ? '0 строк'
          : `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} из ${total}`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-500">
          На странице&nbsp;
          <select value={pagination.pageSize}
                  onChange={(e) => onPageSize(parseInt(e.target.value, 10))}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button disabled={!canPrev} onClick={onFirst} className={btn} aria-label="Первая страница">«</button>
        <button disabled={!canPrev} onClick={onPrev}  className={btn} aria-label="Предыдущая страница">‹</button>
        <span className="text-xs text-zinc-400 tabular-nums">{pagination.pageIndex + 1} / {pageCount}</span>
        <button disabled={!canNext} onClick={onNext}  className={btn} aria-label="Следующая страница">›</button>
        <button disabled={!canNext} onClick={onLast}  className={btn} aria-label="Последняя страница">»</button>
      </div>
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
  // Object anchors are project-scoped, like covers: they land on the Предметы tab.
  if (row.type === 'prop_anchor' && projSeg) {
    return (
      <Link href={`/projects/${projSeg}/props`} className={`text-zinc-200 ${cls}`}>
        {row.label}
      </Link>
    );
  }

  // Music renders target one track (NarrativeBlock) — link straight to its
  // detail page. `context` carries the block slug even on backends that predate
  // the explicit blockSlug field; the #seg- hash pins the exact tile when known.
  if (row.type === 'bgm' && projSeg) {
    const slug = row.blockSlug ?? row.context;
    if (slug) {
      const href = `/projects/${projSeg}/bgm/${slug}${row.segmentId ? `#seg-${row.segmentId}` : ''}`;
      return (
        <Link href={href} className={`text-zinc-200 ${cls}`}>
          {row.label}
        </Link>
      );
    }
  }

  if ((row.type === 'thumbnail' || row.type === 'thumbnail_ideas') && projSeg) {
    return (
      <Link href={`/projects/${projSeg}/thumbnail`} className={`text-zinc-200 ${cls}`}>
        {row.label}
      </Link>
    );
  }

  // Everything without a shot/profile anchor (act narration, music blocks,
  // subtitles, thumbnails without a project link): label alone says it.
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
  if (dt < 0)             return 'только что';
  if (dt < 60_000)        return `${Math.floor(dt / 1000)} с назад`;
  if (dt < 3_600_000)     return `${Math.floor(dt / 60_000)} мин назад`;
  if (dt < 86_400_000)    return `${Math.floor(dt / 3_600_000)} ч назад`;
  return `${Math.floor(dt / 86_400_000)} дн назад`;
}
function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m} мин ${s % 60} с`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

function typeBadge(t: QueueJobType): string {
  if (t === 'training')      return 'bg-purple-950/40 text-purple-300 border-purple-900';
  if (t === 'dataset')       return 'bg-blue-950/40   text-blue-300   border-blue-900';
  if (t === 'scene')         return 'bg-amber-950/40  text-amber-300  border-amber-900';
  if (t === 'video')         return 'bg-rose-950/40   text-rose-300   border-rose-900';
  if (t === 'video_post')    return 'bg-pink-950/40   text-pink-300   border-pink-900';
  if (t === 'tts')           return 'bg-cyan-950/40   text-cyan-300   border-cyan-900';
  if (t === 'anchor')        return 'bg-fuchsia-950/40 text-fuchsia-300 border-fuchsia-900';
  // Object anchors sit next to character anchors in the palette on purpose -
  // same kind of work, different entity.
  if (t === 'prop_anchor')   return 'bg-orange-950/40 text-orange-300 border-orange-900';
  if (t === 'validation')    return 'bg-indigo-950/40 text-indigo-300 border-indigo-900';
  if (t === 'anchor_validation') return 'bg-violet-950/40 text-violet-300 border-violet-900';
  if (t === 'caption')       return 'bg-teal-950/40   text-teal-300   border-teal-900';
  // VO QC sits next to caption in the palette on purpose — both are whisper passes.
  if (t === 'vo_validation') return 'bg-sky-950/40    text-sky-300    border-sky-900';
  // Image QC inherits the retired 'validation' indigo — same mental slot.
  if (t === 'image_qc')      return 'bg-indigo-950/40 text-indigo-300 border-indigo-900';
  if (t === 'video_qc')      return 'bg-indigo-950/40 text-indigo-300 border-indigo-900';
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
