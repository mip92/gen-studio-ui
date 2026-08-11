'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Draggable } from '@fullcalendar/interaction';
import { api, type ReleaseBackfillReport, type ReleaseItem } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { ReadinessBar } from '../../components/releases/ReadinessBar';
import { ReleaseDateCell, fmt } from '../../components/releases/ReleaseDateCell';
import { ReleaseCalendar } from '../../components/releases/ReleaseCalendar';
import { AutoPlanModal } from '../../components/releases/AutoPlanModal';

/**
 * Релизный календарь: месячная сетка (FullCalendar, drag-and-drop переносит
 * релиз на другой день), под ней — бэклог без даты. «Готов» = экспорт-гейт
 * CapCut (та же проверка, что открывает кнопку экспорта). Приоритет рендера
 * календарь НЕ трогает — ставится руками в очереди, как раньше.
 */
export default function ReleasesPage() {
  const [items, setItems]         = useState<ReleaseItem[] | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [planOrder, setPlanOrder] = useState<string[]>([]);
  const [showPlan, setShowPlan]   = useState(false);
  const [backfill, setBackfill]   = useState<ReleaseBackfillReport | null>(null);
  const [busy, setBusy]           = useState<null | 'backfill' | 'backfill-apply'>(null);

  const reload = () =>
    api.listReleases()
      .then((r) => { setItems(r); setPlanOrder((o) => o.filter((id) => r.some((x) => x.id === id && !x.releaseAt))); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => { reload(); }, []);

  // Drag из «Не запланировано» в календарь: FC Draggable вешает делегированный
  // слушатель на контейнер, так что перерисовки строк ему не мешают.
  const backlogRef = useRef<HTMLDivElement | null>(null);
  const hasBacklog = (items ?? []).some((r) => !r.releaseAt);
  useEffect(() => {
    if (!backlogRef.current) return;
    const d = new Draggable(backlogRef.current, {
      itemSelector: '[data-release-id]',
      eventData: (el) => ({
        id: el.getAttribute('data-release-id')!,
        title: el.getAttribute('data-release-title') ?? '',
        create: true,
      }),
    });
    return () => d.destroy();
  }, [hasBacklog]);

  const rows = items ?? [];
  // ВСЕ строки без даты, включая опубликованные-несинхронизированные: у тех
  // ручная правка залочена (409), их путь в календарь — сверка с YouTube,
  // и прятать их со страницы нельзя (ревью 2026-08-07).
  const unscheduled = useMemo(() => rows.filter((r) => !r.releaseAt), [rows]);
  const names = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);

  const runBackfill = async (dryRun: boolean) => {
    setBusy(dryRun ? 'backfill' : 'backfill-apply'); setError(null);
    try {
      const report = await api.backfillReleases(dryRun);
      setBackfill(report);
      if (!dryRun) reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleOrder = (id: string) =>
    setPlanOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const moveOrder = (id: string, dir: -1 | 1) =>
    setPlanOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Релизы' }]}
        title="Релизы"
        subtitle="Красный — вышел, синий — залито с отложенной публикацией (дата с YouTube), зелёный — план и готов к экспорту, янтарный — план, гейт не пройден. Перенос — перетащи карточку или кликни по ней. Сетка канала: вт/чт 16:00."
        actions={
          <button type="button" disabled={busy !== null} onClick={() => runBackfill(true)}
            className="px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50">
            {busy === 'backfill' ? 'Сверяю…' : 'Сверить с YouTube'}
          </button>
        }
      />

      <main className="p-4 sm:p-8 space-y-6">
      {error && <div className="text-sm text-red-400">{error}</div>}
      {!items && !error && <div className="text-sm text-zinc-500">Загрузка…</div>}

      {backfill && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium text-zinc-200">
              Сверка с YouTube {backfill.dryRun ? '(превью — ничего не записано)' : '(применено)'}
            </div>
            <button type="button" onClick={() => setBackfill(null)} className="text-zinc-500 hover:text-zinc-200">✕</button>
          </div>
          {backfill.updated.length === 0
            && backfill.errors.length === 0
            && backfill.skipped.every((s) => s.reason === 'already_exact')
            && <div className="text-zinc-500">Все даты уже точные.</div>}
          {backfill.updated.map((u) => (
            <div key={u.slug} className="text-zinc-400">
              <span className="text-zinc-200">{u.slug}</span>: {u.previous ? fmt(new Date(u.previous)) : '—'} → {fmt(new Date(u.publishedAt))}
              {u.scheduled && <span className="ml-1 text-blue-400">(отложенная публикация)</span>}
            </div>
          ))}
          {/* Пропуски — это диагностика «почему у вышедшего нет даты», их нельзя глотать. */}
          {backfill.skipped.filter((s) => s.reason !== 'already_exact').map((s) => (
            <div key={s.slug} className="text-amber-400">
              {s.slug}: {s.reason === 'no_video_id' ? 'не удалось распарсить youtubeUrl' : s.reason === 'not_found_on_yt' ? 'видео не найдено на YouTube' : s.reason}
            </div>
          ))}
          {backfill.skipped.some((s) => s.reason === 'already_exact') && (
            <div className="text-zinc-600">
              уже точные: {backfill.skipped.filter((s) => s.reason === 'already_exact').length}
            </div>
          )}
          {backfill.errors.map((e, i) => <div key={i} className="text-red-400">{e}</div>)}
          {backfill.dryRun && backfill.updated.length > 0 && (
            <button type="button" disabled={busy !== null} onClick={() => runBackfill(false)}
              className="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
              {busy === 'backfill-apply' ? 'Записываю…' : `Записать ${backfill.updated.length} дат`}
            </button>
          )}
        </div>
      )}

      {/* ── Месячная сетка ── */}
      {items && <ReleaseCalendar rows={rows} onChanged={reload} unscheduleRef={backlogRef} />}

      {/* ── Бэклог без даты ── */}
      {unscheduled.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider text-zinc-500">Не запланировано ({unscheduled.length})</h2>
            <button type="button" disabled={planOrder.length === 0} onClick={() => setShowPlan(true)}
              className="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
              Расставить по слотам ({planOrder.length})
            </button>
          </div>
          <div ref={backlogRef} className="bg-zinc-900 border border-zinc-800 rounded divide-y divide-zinc-800">
            {unscheduled.map((r) => {
              const pos = planOrder.indexOf(r.id);
              return (
                <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {/* Ручка внешнего drag'а: утащи строку прямо на день календаря
                      (время встанет 16:00 — слот канала). */}
                  {!r.uploaded && (
                    <span
                      data-release-id={r.id}
                      data-release-title={r.name}
                      title="Перетащи на день в календаре"
                      className="cursor-grab select-none text-zinc-600 hover:text-zinc-300 shrink-0"
                    >
                      ⠿
                    </span>
                  )}
                  {/* Залитым-без-даты планирование недоступно: их дата — факт/расписание,
                      которое приносит только сверка с YouTube. */}
                  {!r.uploaded && (
                    <label className="flex items-center gap-2 w-8 shrink-0 text-xs text-zinc-500">
                      <input type="checkbox" checked={pos >= 0} onChange={() => toggleOrder(r.id)} className="accent-blue-600" />
                      {pos >= 0 && <span className="font-mono text-blue-400">{pos + 1}</span>}
                    </label>
                  )}
                  {pos >= 0 && (
                    <span className="flex gap-0.5 shrink-0">
                      <button type="button" onClick={() => moveOrder(r.id, -1)} className="px-1 text-zinc-500 hover:text-zinc-200" title="Раньше">↑</button>
                      <button type="button" onClick={() => moveOrder(r.id, 1)} className="px-1 text-zinc-500 hover:text-zinc-200" title="Позже">↓</button>
                    </span>
                  )}
                  <Link href={`/projects/${r.id}`} className="flex-1 min-w-40 text-sm text-zinc-100 hover:text-blue-400 truncate">
                    {r.name}
                  </Link>
                  {r.uploaded ? (
                    <>
                      <a href={r.youtubeUrl!} target="_blank" rel="noreferrer"
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/50 text-red-300 border border-red-800 hover:bg-red-900">
                        ▶ на YouTube
                      </a>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/40 text-amber-300 border border-amber-800">
                        нет даты — «Сверить с YouTube»
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="w-40 shrink-0 text-xs">
                        <ReleaseDateCell idOrSlug={r.id} releaseAt={null} onSaved={reload} />
                      </div>
                      <ReadinessBar r={r} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-600">
            Тащи ⠿ прямо на день в календаре (встанет в 16:00), а карточку из календаря — сюда, чтобы снять дату.
            Либо массово: отметь фильмы галочками в порядке выхода — «Расставить по слотам» раздаст ближайшие свободные вт/чт.
          </p>
        </section>
      )}

      {showPlan && (
        <AutoPlanModal
          order={planOrder}
          names={names}
          onClose={() => setShowPlan(false)}
          onPlanned={() => { setShowPlan(false); setPlanOrder([]); reload(); }}
        />
      )}
      </main>
    </div>
  );
}
