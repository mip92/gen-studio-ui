'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { api, ActionItem, ActionGateKey, ProjectListItem, isProjectArchived } from '../../lib/api';

const GATE_LABELS: Record<ActionGateKey, { num: number; ru: string }> = {
  upload_dataset_images: { num: 1,  ru: 'Загрузить изображения' },
  start_dataset:         { num: 2,  ru: 'Запустить датасет' },
  start_training:        { num: 3,  ru: 'Запустить тренировку LoRA' },
  // Cartoon projects use only this gate for character setup. Slots into the
  // same "phase 1" zone as the photoreal upload/dataset gates above.
  generate_anchor:       { num: 1,  ru: 'Сгенерировать anchor (cartoon)' },
  render_scene:          { num: 4,  ru: 'Сгенерировать сцену' },
  approve_render:        { num: 5,  ru: 'Утвердить рендер' },
  create_video:          { num: 6,  ru: 'Создать видео' },
  approve_video:         { num: 7,  ru: 'Утвердить видео' },
  upscale_video:         { num: 8,  ru: 'Апскейл видео' },
  interpolate_video:     { num: 9,  ru: 'Увеличить FPS (обязательно)' },
  render_tts:            { num: 10, ru: 'Озвучить — нет голоса' },
  approve_tts:           { num: 11, ru: 'Утвердить закадровый голос' },
  approve_bgm:           { num: 12, ru: 'Утвердить фоновую музыку' },
};

// Gate order on the page — characters first (anchor for cartoon OR 1-3 for
// photoreal), shots second (4-9), BGM last (10).
const GATE_ORDER: ActionGateKey[] = [
  'generate_anchor',
  'upload_dataset_images',
  'start_dataset',
  'start_training',
  'render_scene',
  'approve_render',
  'create_video',
  'approve_video',
  'upscale_video',
  'interpolate_video',
  'render_tts',
  'approve_tts',
  'approve_bgm',
];

const PAGE_SIZE = 100;

// useSearchParams() requires a Suspense boundary in a statically-rendered
// client page (Next 16) — wrap the inner component so the production build
// doesn't bail out.
export default function ActionsPage() {
  return (
    <Suspense fallback={<div className="bg-zinc-950 text-zinc-100 min-h-full" />}>
      <ActionsInner />
    </Suspense>
  );
}

function ActionsInner() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // ── State lives in the URL (filters + page are shareable / bookmarkable) ──
  const projectSlug = searchParams.get('project') ?? '';
  const gateFilter  = (searchParams.get('gate') as ActionGateKey | '') || '';
  const page        = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [items, setItems]         = useState<ActionItem[] | null>(null);
  const [projects, setProjects]   = useState<ProjectListItem[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Merge a partial set of params into the URL, dropping empty ones. Uses
  // replace() so filter/page churn doesn't bloat the browser history (matters
  // on a tablet where the back button would otherwise step through every page).
  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  // Single fetch (project filter is applied server-side to keep the payload
  // small). NO setInterval — the old 10s long-poll kept the tablet awake and
  // drained the battery. Freshness now comes from (a) this running on
  // project-change, (b) the manual "Обновить" button, (c) a visibilitychange
  // refetch when the user returns to the tab — all event-driven, zero idle cost.
  const fetchActions = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.listActions(projectSlug || undefined);
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRefreshing(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    (async () => {
      try {
        const res = await api.listActions(projectSlug || undefined);
        if (!cancelled) { setItems(res.items); setError(null); }
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { cancelled = true; };
  }, [projectSlug]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchActions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchActions]);

  // Gate options for the filter dropdown — only gates actually present (with
  // counts), in canonical order. Built from the full (project-filtered) set so
  // the menu reflects everything, not just the current page.
  const gateOptions = useMemo(() => {
    const counts = new Map<ActionGateKey, number>();
    for (const i of items ?? []) counts.set(i.gateKey, (counts.get(i.gateKey) ?? 0) + 1);
    return GATE_ORDER
      .filter((k) => counts.has(k))
      .map((k) => ({ key: k, count: counts.get(k)!, label: GATE_LABELS[k].ru }));
  }, [items]);

  // Filter by gate (client-side), then flatten to a stable order so page
  // boundaries are deterministic: by project name, then canonical gate order.
  const ordered = useMemo(() => {
    const base = gateFilter ? (items ?? []).filter((i) => i.gateKey === gateFilter) : (items ?? []);
    return [...base].sort((a, b) => {
      const pn = a.project.name.localeCompare(b.project.name);
      if (pn !== 0) return pn;
      return GATE_ORDER.indexOf(a.gateKey) - GATE_ORDER.indexOf(b.gateKey);
    });
  }, [items, gateFilter]);

  const total     = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => ordered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [ordered, safePage],
  );

  // Group the current page's items by project, then by gate (canonical order).
  const grouped = useMemo(() => {
    const byProject = new Map<string, { project: ActionItem['project']; gates: Map<ActionGateKey, ActionItem[]> }>();
    for (const item of pageItems) {
      let entry = byProject.get(item.project.id);
      if (!entry) {
        entry = { project: item.project, gates: new Map() };
        byProject.set(item.project.id, entry);
      }
      const list = entry.gates.get(item.gateKey) ?? [];
      list.push(item);
      entry.gates.set(item.gateKey, list);
    }
    return Array.from(byProject.values()).sort((a, b) => a.project.name.localeCompare(b.project.name));
  }, [pageItems]);

  const handleRun = async (item: ActionItem, key: string) => {
    if (!item.action) return;
    setRunningId(key);
    try {
      await api.runAction(item.action);
      // Optimistic: re-fetch immediately so the row disappears once the next
      // gate kicks in.
      const res = await api.listActions(projectSlug || undefined);
      setItems(res.items);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunningId(null);
    }
  };

  const goToPage = (n: number) => setParams({ page: n <= 1 ? null : String(n) });

  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-full">
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Действия' }]}
        title="Действия"
        subtitle={items === null ? '…' : `${total} ожидают${gateFilter || projectSlug ? ' (фильтр)' : ''}`}
        actions={
          <>
            <button
              onClick={fetchActions}
              disabled={refreshing}
              className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs disabled:opacity-50 disabled:cursor-wait"
              title="Обновить список"
            >
              {refreshing ? '…' : '⟳ Обновить'}
            </button>

            <label className="text-xs uppercase tracking-wider text-zinc-500">Гейт:</label>
            <select
              value={gateFilter}
              onChange={(e) => setParams({ gate: e.target.value || null, page: null })}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded px-2 py-1 max-w-[14rem]"
            >
              <option value="">Все</option>
              {gateOptions.map((g) => (
                <option key={g.key} value={g.key}>{g.label} ({g.count})</option>
              ))}
            </select>

            <label className="text-xs uppercase tracking-wider text-zinc-500">Проект:</label>
            <select
              value={projectSlug}
              onChange={(e) => setParams({ project: e.target.value || null, page: null })}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded px-2 py-1"
            >
              <option value="">Все</option>
              {projects
                // Archived (published) projects have no pending gates — hide
                // them from the filter, but keep the current URL selection valid.
                .filter((p) => !isProjectArchived(p) || p.slug === projectSlug)
                .map((p) => (
                  <option key={p.id} value={p.slug}>{p.name}</option>
                ))}
            </select>
          </>
        }
        below={pageCount > 1 ? <Pager safePage={safePage} pageCount={pageCount} total={total} onGo={goToPage} /> : undefined}
      />

      <main className="p-4 sm:p-8 space-y-8">
        {error && (
          <div className="rounded border border-red-900 bg-red-950 text-red-200 text-sm px-4 py-3">
            <div className="font-semibold mb-1">Не удалось загрузить /actions</div>
            <div className="font-mono text-xs whitespace-pre-wrap">{error}</div>
            <div className="text-xs text-red-300 mt-2">
              Если 404 — бэкенд ещё не перезапущен после добавления ActionsModule. После тренировки LoRA сделай рестарт: <code className="bg-black/30 px-1 rounded">npm start</code> в gen-studio.
            </div>
          </div>
        )}

        {items !== null && total === 0 && !error && (
          <div className="text-sm text-zinc-500 text-center py-16">
            {gateFilter || projectSlug
              ? 'Под фильтр ничего не подходит.'
              : 'Нет задач, ожидающих действий. Всё в работе или в очереди.'}
          </div>
        )}

        {grouped.map(({ project, gates }) => (
          <section key={project.id} className="space-y-4">
            <div className="border-b border-zinc-800 pb-1">
              <Link
                href={`/projects/${project.id}`}
                className="text-lg font-semibold text-zinc-100 hover:text-zinc-300"
              >
                {project.name}
              </Link>
              <span className="ml-3 text-xs text-zinc-500">{project.slug}</span>
            </div>

            {GATE_ORDER.filter((k) => gates.has(k)).map((gateKey) => {
              const list  = gates.get(gateKey)!;
              const label = GATE_LABELS[gateKey];
              return (
                <div key={gateKey} className="rounded border border-zinc-800 bg-zinc-900/50">
                  <div className="px-4 py-2 border-b border-zinc-800 flex items-baseline gap-2">
                    <span className="text-xs font-mono text-zinc-500">#{label.num}</span>
                    <span className="text-sm font-medium text-zinc-200">{label.ru}</span>
                    <span className="ml-auto text-xs text-zinc-500">{list.length}</span>
                  </div>
                  <ul className="divide-y divide-zinc-800">
                    {list.map((item) => {
                      const key = `${item.gateKey}-${item.profile?.id ?? item.shot?.id ?? item.segment?.id ?? item.scene?.id}`;
                      return (
                        <li key={key} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                          <span className="flex-1 min-w-0 truncate text-zinc-200">
                            <Target item={item} />
                          </span>
                          <Link
                            href={item.link}
                            className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                          >
                            Открыть
                          </Link>
                          {item.action && (
                            <button
                              onClick={() => handleRun(item, key)}
                              disabled={runningId === key}
                              className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs disabled:opacity-50 disabled:cursor-wait"
                            >
                              {runningId === key ? '…' : 'Запустить'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}

        {pageCount > 1 && (
          <div className="pt-2 flex justify-center">
            <Pager safePage={safePage} pageCount={pageCount} total={total} onGo={goToPage} />
          </div>
        )}
      </main>
    </div>
  );
}

/** Compact prev/next pager with page + total readout. Used in the sticky header
 *  (always visible) and at the bottom of the list. */
function Pager({ safePage, pageCount, total, onGo }: {
  safePage: number; pageCount: number; total: number; onGo: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onGo(safePage - 1)}
        disabled={safePage <= 1}
        className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Назад
      </button>
      <span className="text-xs text-zinc-400 tabular-nums">
        Стр. {safePage} / {pageCount} · {total} шт.
      </span>
      <button
        onClick={() => onGo(safePage + 1)}
        disabled={safePage >= pageCount}
        className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Вперёд →
      </button>
    </div>
  );
}

/** Render the human-readable target label for a row, depending on whether the
 *  gate is character-scoped (1-3), shot-scoped (4-9), segment-scoped (10 BGM),
 *  or the rarer scene-only case (gate 9 legacy scene-VO). */
function Target({ item }: { item: ActionItem }) {
  if (item.character && item.profile) {
    const name = item.character.displayName || item.character.code;
    return (
      <>
        <span className="font-medium">{name}</span>
        <span className="text-zinc-500"> · {item.profile.code}</span>
      </>
    );
  }
  if (item.shot) {
    const sceneLabel = item.scene?.title || item.scene?.sceneKey || '';
    return (
      <>
        <span className="font-medium">{item.shot.code}</span>
        {sceneLabel && <span className="text-zinc-500"> · {sceneLabel}</span>}
      </>
    );
  }
  if (item.segment) {
    const blockLabel = item.segment.block.title || item.segment.block.slug;
    return (
      <>
        <span className="font-medium">{blockLabel} · сегмент {item.segment.sortOrder + 1}</span>
        <span className="text-zinc-500"> · {item.segment.durationSec}s</span>
      </>
    );
  }
  if (item.scene) {
    return (
      <>
        <span className="font-medium">{item.scene.title || item.scene.sceneKey}</span>
        <span className="text-zinc-500"> · сцена</span>
      </>
    );
  }
  return <span className="text-zinc-500">—</span>;
}
