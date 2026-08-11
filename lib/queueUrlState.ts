import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table';
import type { QueueJobType, QueueSortField } from './api';

/**
 * URL <-> TanStack state for the queue table.
 *
 * The three queue tabs (Активные / Все / Готовые) each carry a preset — the
 * filters and sort they open with. That preset is now a DEFAULT rather than
 * seeded local state: any param present in the URL overrides it, so
 * `/queue/active?project=irreplaceable&sort=duration&order=desc&page=2` restores
 * exactly that view on load and can be shared or bookmarked.
 *
 * Multi-value filters are CSV in a single param (`?status=pending,running`) —
 * the same encoding `api.pipelineQueue()` sends to GET /pipeline/queue, so the
 * browser URL and the backend querystring are byte-identical for these keys.
 *
 * Kept free of React on purpose: pure functions, testable in isolation.
 */

export interface QueuePreset {
  sort:     QueueSortField;
  desc:     boolean;
  statuses: string[];
  types:    QueueJobType[];
  projects: string[];
}

export const QUEUE_DEFAULT_PAGE_SIZE = 50;

/** Params this module owns. Anything else in the URL is left untouched. */
export const QUEUE_URL_KEYS = ['sort', 'order', 'status', 'type', 'project', 'page', 'limit'] as const;

function splitCsv(v: string | null): string[] {
  return v === null ? [] : v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Order-insensitive set comparison — filter dropdowns don't guarantee order. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
}

/**
 * URL -> table state. An ABSENT param falls back to the tab preset; a PRESENT
 * one wins, including when it is empty (`?status=` means "the user cleared this
 * filter", which must not snap back to the preset on reload).
 */
export function parseQueueUrlState(
  sp:     URLSearchParams,
  preset: QueuePreset,
): { sorting: SortingState; columnFilters: ColumnFiltersState; pagination: PaginationState } {
  const sortId = (sp.get('sort') as QueueSortField | null) ?? preset.sort;
  const desc   = sp.has('order') ? sp.get('order') !== 'asc' : preset.desc;

  const statuses = sp.has('status')  ? splitCsv(sp.get('status'))                 : preset.statuses;
  const types    = sp.has('type')    ? (splitCsv(sp.get('type')) as QueueJobType[]) : preset.types;
  const projects = sp.has('project') ? splitCsv(sp.get('project'))                : preset.projects;

  // TanStack carries "no filter" as an absent column entry, not an empty array.
  const columnFilters: ColumnFiltersState = [];
  if (statuses.length > 0) columnFilters.push({ id: 'status',  value: statuses });
  if (types.length    > 0) columnFilters.push({ id: 'type',    value: types });
  if (projects.length > 0) columnFilters.push({ id: 'project', value: projects });

  const pageN  = Number(sp.get('page'));
  const limitN = Number(sp.get('limit'));

  return {
    sorting: [{ id: sortId, desc }],
    columnFilters,
    pagination: {
      pageIndex: Number.isFinite(pageN)  && pageN  > 0 ? pageN - 1 : 0,
      // Backend caps at 200; anything else falls back to the default page size.
      pageSize:  Number.isFinite(limitN) && limitN > 0 ? Math.min(limitN, 200) : QUEUE_DEFAULT_PAGE_SIZE,
    },
  };
}

/**
 * Table state -> URL params, as a partial update for the caller to merge.
 *
 * `null` = drop the key: the value equals the tab preset, so a fresh visit will
 * re-derive it and the URL stays short. Any string (INCLUDING '') is written
 * literally — an empty string is how a deliberately-cleared filter survives a
 * reload on a tab whose preset is non-empty. Note this differs from /actions'
 * `setParams`, which treats '' as "delete"; do not swap one for the other.
 */
export function diffQueueUrlState(
  state:  { sorting: SortingState; columnFilters: ColumnFiltersState; pagination: PaginationState },
  preset: QueuePreset,
): Record<string, string | null> {
  const sortId = (state.sorting[0]?.id as QueueSortField | undefined) ?? preset.sort;
  const desc   = state.sorting[0]?.desc ?? preset.desc;
  const sortIsDefault = sortId === preset.sort && desc === preset.desc;

  const pick = (id: string): string[] =>
    (state.columnFilters.find((f) => f.id === id)?.value as string[] | undefined) ?? [];
  const statuses = pick('status');
  const types    = pick('type');
  const projects = pick('project');

  return {
    sort:    sortIsDefault ? null : sortId,
    order:   sortIsDefault ? null : (desc ? 'desc' : 'asc'),
    status:  sameSet(statuses, preset.statuses) ? null : statuses.join(','),
    type:    sameSet(types,    preset.types)    ? null : types.join(','),
    project: sameSet(projects, preset.projects) ? null : projects.join(','),
    page:    state.pagination.pageIndex === 0                      ? null : String(state.pagination.pageIndex + 1),
    limit:   state.pagination.pageSize === QUEUE_DEFAULT_PAGE_SIZE ? null : String(state.pagination.pageSize),
  };
}
