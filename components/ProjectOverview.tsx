'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ScenesResponse, DashboardResponse, ProjectFull } from '../lib/api';
import { useLiveEvents, on } from '../lib/liveEvents';
import { useRefreshable } from '../lib/useRefreshable';
import { RefreshControl } from './RefreshControl';

type Stats = Awaited<ReturnType<typeof api.getProjectStats>>;

export function ProjectOverview({ id }: { id: string }) {
  const [scenes,    setScenes]    = useState<ScenesResponse    | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [stats,     setStats]     = useState<Stats             | null>(null);
  const [project,   setProject]   = useState<ProjectFull       | null>(null);

  const load = useCallback(async () => {
    const [s, d, st, pr] = await Promise.all([
      api.listScenes(id),
      api.dashboard(id),
      api.getProjectStats(id).catch(() => null),
      api.getProject(id).catch(() => null),
    ]);
    setScenes(s);
    setDashboard(d);
    setStats(st);
    setProject(pr);
  }, [id]);

  const { refreshing, error: loadError, lastUpdatedAt, refresh } = useRefreshable(load);

  // This page had NO refresh path at all before — it fetched once on mount, so
  // the forecast and waste numbers went stale the moment anything finished and
  // only a full page reload fixed them.
  //
  // `on.finished` (op === 'closed') and not every delta: /projects/:id/stats is
  // the heavy read here (forecast, per-stage costs, waste breakdown) and those
  // numbers only move when work COMPLETES. A reorder or a priority bump changes
  // nothing worth recomputing. `active: false` — a stats page should not hold a
  // socket open on its own; it still hears deltas while one is up for another
  // reason, and always re-reads on tab wake.
  const statsMatch = useCallback(
    (e: Parameters<typeof on.finished>[0]) => on.finished(e) && on.project(id)(e),
    [id],
  );
  useLiveEvents(statsMatch, refresh, { active: false });

  if (loadError)     return <Pad><Err msg={loadError} /></Pad>;
  if (!scenes || !dashboard) return <Pad><p className="text-zinc-500">Loading…</p></Pad>;

  const slug       = dashboard.project.slug;
  const totalShots = scenes.scenes.reduce((sum, s) => sum + s.shots.length, 0);
  const total      = dashboard.profiles.length;

  // Which identity asset this film actually uses. Anchor-driven styles
  // (realcomic_qwen, graphic_novel_*) never get a loraPath, so counting LoRAs
  // there showed a permanent, meaningless «LoRA готовы 0 / N» — the overview must
  // report only what the project uses (user 2026-08-10). Older backends don't
  // send `identity`; falling back to 'lora' reproduces the previous behaviour.
  const usesLora = (dashboard.identity?.kind ?? 'lora') === 'lora';
  const ready    = dashboard.profiles.filter((p) => (usesLora ? p.loraReady : p.anchorReady)).length;
  // Click-through lands where the missing ones get produced; with nothing missing
  // that gate list is empty, so point at the cast instead.
  const identityHref = ready < total
    ? `/actions?project=${slug}&gate=${usesLora ? 'start_training' : 'generate_anchor'}`
    : `/projects/${id}/characters`;

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex justify-end mb-3">
        <RefreshControl
          lastUpdatedAt={lastUpdatedAt}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      </div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <Stat label="Акты"      value={String(scenes.scenes.length)} href={`/projects/${id}/scenes`} />
          <Stat label="Кадры"     value={String(totalShots)}           href={`/projects/${id}/scenes`} />
          <Stat label="Персонажи" value={String(total)}                href={`/projects/${id}/characters`} />
          <Stat
            label={usesLora ? 'LoRA готовы' : 'Якоря готовы'}
            value={`${ready} / ${total}`}
            highlight={ready > 0}
            href={identityHref}
            hint={usesLora ? undefined : 'личность держит утверждённый якорь — LoRA этот стиль не тренирует'}
          />
        </section>
      </div>

      <PublishCard
        projectId={id}
        initialUrl={project?.youtubeUrl ?? null}
        onChange={(url) => setProject((p) => (p ? { ...p, youtubeUrl: url } : p))}
      />

      {stats?.spent && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
            Реально потрачено на фильм
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Всего машинного времени" value={fmtHours(stats.spent.totalSeconds)}
                  hint="сумма фактического времени всех попыток, включая удалённые кадры и видео" />
            <Stat label="В финальной версии" value={fmtHours(stats.spent.usefulSeconds)} highlight />
            <Stat label="Впустую" value={fmtHours(stats.spent.wastedSeconds)}
                  hint={stats.spent.wastePercent !== null ? `${stats.spent.wastePercent}% брака` : undefined} />
            <Stat label="Ещё не решено" value={fmtHours(stats.spent.unresolvedSeconds)}
                  hint="кадр отрисован, но выбор ещё не сделан" />
          </div>

          {stats.byReason && stats.byReason.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              {stats.byReason.map((r) => (
                <Stat key={r.reason} label={reasonLabel(r.reason)} value={fmtHours(r.seconds)}
                      hint={`${r.count} шт.`}
                      href={reasonQueueHref(slug, r.reason)} />
              ))}
            </div>
          )}

          {stats.byType && stats.byType.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded overflow-x-auto mb-3">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left  px-3 py-2 font-normal">Этап</th>
                    <th className="text-right px-3 py-2 font-normal">Попыток</th>
                    <th className="text-right px-3 py-2 font-normal">Всего</th>
                    <th className="text-right px-3 py-2 font-normal">В дело</th>
                    <th className="text-right px-3 py-2 font-normal">Впустую</th>
                    <th className="text-right px-3 py-2 font-normal">Брак</th>
                    <th className="text-right px-3 py-2 font-normal">Средняя</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {stats.byType.map((t) => (
                    <tr key={t.type} className="hover:bg-zinc-950/40">
                      <td className="px-3 py-1.5 font-mono text-xs text-zinc-300">
                        {/* Every attempt of this stage for this film, in the queue
                            ledger — where the failures and re-renders are visible. */}
                        <Link href={`/queue/all?project=${slug}&type=${t.type}`}
                              className="hover:text-white underline-offset-2 hover:underline">
                          {stageLabel(t.type)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs text-zinc-400">{t.attempts}</td>
                      <td className="px-3 py-1.5 text-right text-xs text-zinc-300">{fmtHours(t.totalSeconds)}</td>
                      <td className="px-3 py-1.5 text-right text-xs text-emerald-400">{fmtHours(t.usefulSeconds)}</td>
                      <td className="px-3 py-1.5 text-right text-xs text-red-400">{fmtHours(t.wastedSeconds)}</td>
                      <td className="px-3 py-1.5 text-right text-xs text-zinc-400">
                        {t.wastePercent !== null ? `${t.wastePercent}%` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs text-zinc-500">
                        {t.avgSeconds !== null ? fmtShort(t.avgSeconds) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.caveats && stats.caveats.truncatedHistoryEntries > 0 && (
            <p className="text-xs text-zinc-600">
              {stats.caveats.backfilledEntries} записей восстановлено из истории заданий,
              у {stats.caveats.truncatedHistoryEntries} часть прошлых попыток была стёрта до
              появления журнала — брак за прошлое считается по нижней границе.
            </p>
          )}
        </section>
      )}

      {stats?.forecast && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
            Сколько осталось
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Если проект в приоритете" value={fmtHours(stats.forecast.exclusiveSeconds)}
                  highlight
                  hint={stats.forecast.calendar ? `≈ ${stats.forecast.calendar.exclusiveDays} дн. при текущем темпе` : undefined} />
            <Stat label="С учётом всей очереди" value={fmtHours(stats.forecast.realisticSeconds)}
                  hint={stats.forecast.calendar ? `≈ ${stats.forecast.calendar.realisticDays} дн. при текущем темпе` : undefined} />
            <Stat label="Уже в очереди" value={String(stats.forecast.breakdown.queuedOwnJobs)}
                  hint={`${fmtHours(stats.forecast.breakdown.queuedOwnSeconds)} своих задач`}
                  href={`/queue/active?project=${slug}`} />
            <Stat label="Впереди чужих задач" value={String(stats.forecast.breakdown.jobsAheadOfIt)}
                  hint={`${fmtHours(stats.forecast.breakdown.queueAheadSeconds)} до старта этого проекта`}
                  href="/queue/active?status=pending" />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded p-3 mb-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Ещё даже не поставлено в очередь — {fmtHours(stats.forecast.breakdown.notQueuedSeconds)}
            </div>
            {/* Each stage links to the /actions gate that starts it, pre-filtered
                to this film — that list IS the work these numbers count. */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400 font-mono">
              {Object.entries(stats.forecast.breakdown.notQueuedStages).map(([stage, n]) => (
                <StageChip key={stage} slug={slug} stage={stage} label={stageLabel(stage)} count={n} />
              ))}
              {stats.forecast.breakdown.notQueuedBgmSegments > 0 && (
                <StageChip slug={slug} stage="bgm" label="музыка"
                           count={stats.forecast.breakdown.notQueuedBgmSegments} />
              )}
            </div>
          </div>

          <p className="text-xs text-zinc-600">
            Прогноз = оставшиеся стадии × средняя длительность × поправка на брак
            {stats.forecast.calendar && <> ; календарь — по фактической выработке ({fmtHours(stats.forecast.calendar.secondsOfWorkPerDay)}/день, {stats.forecast.calendar.basis})</>}.
            Не учтено: {stats.forecast.excludes.join(', ')}.
          </p>
        </section>
      )}

    </main>
  );
}

/** Seconds → "12.4 ч" / "38 мин" / "45 с" — the scale the numbers actually span. */
function fmtHours(seconds: number): string {
  if (!seconds || seconds < 1) return '0';
  if (seconds < 90)       return `${Math.round(seconds)} с`;
  if (seconds < 3600)     return `${Math.round(seconds / 60)} мин`;
  return `${(seconds / 3600).toFixed(1)} ч`;
}

/** Per-attempt averages are always small — keep them in seconds/minutes. */
function fmtShort(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} с`;
  return `${Math.round(seconds / 60)} мин`;
}

function stageLabel(type: string): string {
  // Держать в синке с TYPE_LABELS в QueueTable.tsx — это те же jobType.
  // «кадр (SDXL)» врал для qwen/flux-проектов (user 2026-08-07, station).
  const map: Record<string, string> = {
    scene:             'кадр img',
    end_frame:         'посл. кадр',
    video:             'видео (i2v)',
    video_post:        'FHD + FPS',
    tts:               'озвучка',
    bgm:               'музыка',
    anchor:            'якорь',
    prop_anchor:       'якорь предм.',
    validation:        'вижн-проверка',
    anchor_validation: 'проверка якоря',
    dataset:           'датасет',
    training:          'LoRA',
    caption:           'субтитры',
    thumbnail:         'обложка',
    thumbnail_ideas:   'идеи обложки',
    vo_validation:     'озвучка qc',
    image_qc:          'кадр qc',
  };
  return map[type] ?? type;
}

/**
 * The /actions gate that starts a not-yet-queued stage, so the forecast's
 * "ещё не поставлено в очередь" chips lead straight to the work they count.
 * Keys are the stage ids from ProjectStatsService.remainingStages.
 */
const STAGE_GATE: Record<string, string> = {
  scene:      'render_scene',
  video:      'create_video',
  // Upscale and FPS are one job now, and `upscale_video` is the gate that offers
  // it; `interpolate_video` only appears for clips already upscaled by the old
  // two-step pipeline.
  video_post: 'upscale_video',
  tts:        'render_tts',
  bgm:        'render_bgm',
};

function StageChip({ slug, stage, label, count }: {
  slug: string; stage: string; label: string; count: number;
}) {
  const gate = STAGE_GATE[stage];
  const body = <>{label}: <span className="text-zinc-200">{count}</span></>;
  if (!gate) return <span>{body}</span>;
  return (
    <Link href={`/actions?project=${slug}&gate=${gate}`}
          className="hover:text-white underline-offset-2 hover:underline">
      {body}
    </Link>
  );
}

/**
 * Queue link for a waste reason, or undefined when the ledger can't be filtered
 * by it. Only `failed` and `cancelled` are queue STATUSES; superseded / rejected
 * / deleted / orphaned / unknown live in `outcomeReason`, which
 * GET /pipeline/queue does not accept as a filter — those stay plain text rather
 * than link to a list that would silently ignore the filter.
 */
function reasonQueueHref(slug: string, reason: string): string | undefined {
  if (reason === 'failed')    return `/queue/all?project=${slug}&status=failed`;
  if (reason === 'cancelled') return `/queue/all?project=${slug}&status=cancelled`;
  return undefined;
}

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    failed:     'Провалы',
    cancelled:  'Отмены',
    superseded: 'Перерендеры (не вошли)',
    rejected:   'Отклонено вижн-проверкой',
    deleted:    'Удалено вручную',
    orphaned:   'Осиротело при удалении',
    unknown:    'Непонятно',
  };
  return map[reason] ?? reason;
}

/**
 * "Project done" control. Paste the published YouTube URL → the project is
 * marked finished and /actions stops surfacing pipeline gates for it. Shows the
 * live link + a "снять отметку" when set, an input + "пометить готовым" when not.
 */
function PublishCard({
  projectId, initialUrl, onChange,
}: {
  projectId: string;
  initialUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const [url,   setUrl]   = useState(initialUrl ?? '');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Keep the input in sync if the parent reloads the project.
  useEffect(() => { setUrl(initialUrl ?? ''); setEditing(false); }, [initialUrl]);

  const save = async (value: string) => {
    setBusy(true); setErr(null);
    try {
      const updated = await api.updateProject(projectId, { youtubeUrl: value });
      onChange(updated.youtubeUrl ?? null);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const published = !!initialUrl && !editing;

  return (
    <section className={`rounded-lg border p-4 mb-6 ${published ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900'}`}>
      {published ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-emerald-300 text-sm font-semibold">✅ Проект готов — видео опубликовано</span>
          <a
            href={initialUrl!}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm font-mono break-all underline"
          >
            {initialUrl}
          </a>
          <span className="text-zinc-500 text-xs">/actions больше не требует действий по этому проекту.</span>
          <button
            onClick={() => setEditing(true)}
            className="ml-auto text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1 rounded"
          >
            ✎ изменить
          </button>
          <button
            onClick={() => save('')}
            disabled={busy}
            className="text-xs bg-amber-900/70 hover:bg-amber-700 disabled:opacity-30 text-white px-3 py-1 rounded"
          >
            {busy ? '⏳…' : '↩ снять отметку'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-zinc-300">Ссылка на готовое видео (YouTube)</div>
          <div className="text-zinc-500 text-xs">
            Вставь ссылку на опубликованный ролик — проект пометится готовым, и в /actions перестанут
            требоваться доп. действия (рендер / FHD / увеличение FPS / озвучка).
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtu.be/…"
              className="flex-1 min-w-[260px] bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-emerald-600"
            />
            <button
              onClick={() => save(url)}
              disabled={busy || !url.trim()}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded whitespace-nowrap"
            >
              {busy ? '⏳…' : '✓ пометить готовым'}
            </button>
            {initialUrl && (
              <button
                onClick={() => { setEditing(false); setUrl(initialUrl); }}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-2 rounded"
              >
                отмена
              </button>
            )}
          </div>
          {err && <div className="text-red-400 text-xs">{err}</div>}
        </div>
      )}
    </section>
  );
}

/** A number on the overview. With `href` the whole card becomes a link into the
 *  table that lists what the number counts, pre-filtered to this project. */
function Stat({
  label, value, highlight, hint, href,
}: {
  label:      string;
  value:      string;
  highlight?: boolean;
  hint?:      string;
  href?:      string;
}) {
  const body = (
    <>
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[10px] text-zinc-600 mt-1 leading-snug">{hint}</div>}
    </>
  );
  const cls = `bg-zinc-900 border rounded-lg p-4 ${highlight ? 'border-emerald-700/60' : 'border-zinc-800'}`;

  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link href={href} className={`${cls} block hover:bg-zinc-800/60 hover:border-zinc-600 transition-colors`}>
      {body}
    </Link>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <main className="px-4 sm:px-8 py-6">{children}</main>;
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="bg-red-900/40 border border-red-700 rounded p-4">
      <p className="text-red-200 font-mono text-sm">{msg}</p>
    </div>
  );
}

