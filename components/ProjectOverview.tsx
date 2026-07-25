'use client';

import { useEffect, useState } from 'react';
import { api, ScenesResponse, DashboardResponse, ProjectFull } from '../lib/api';

type Stats = Awaited<ReturnType<typeof api.getProjectStats>>;

export function ProjectOverview({ id }: { id: string }) {
  const [scenes,    setScenes]    = useState<ScenesResponse    | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [stats,     setStats]     = useState<Stats             | null>(null);
  const [project,   setProject]   = useState<ProjectFull       | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (error)         return <Pad><Err msg={error} /></Pad>;
  if (!scenes || !dashboard) return <Pad><p className="text-zinc-500">Loading…</p></Pad>;

  const totalShots = scenes.scenes.reduce((sum, s) => sum + s.shots.length, 0);
  const ready      = dashboard.profiles.filter((p) => p.loraReady).length;
  const total      = dashboard.profiles.length;

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex items-start justify-between mb-6 gap-4">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <Stat label="Сцены"      value={String(scenes.scenes.length)} />
          <Stat label="Кадры"      value={String(totalShots)} />
          <Stat label="Персонажи"  value={String(total)} />
          <Stat label="LoRA готовы" value={`${ready} / ${total}`} highlight={ready > 0} />
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
                  hint="сумма фактического времени всех попыток, включая удалённые кадры и сцены" />
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
                      hint={`${r.count} шт.`} />
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
                    <tr key={t.type}>
                      <td className="px-3 py-1.5 font-mono text-xs text-zinc-300">{stageLabel(t.type)}</td>
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
                  hint={`${fmtHours(stats.forecast.breakdown.queuedOwnSeconds)} своих задач`} />
            <Stat label="Впереди чужих задач" value={String(stats.forecast.breakdown.jobsAheadOfIt)}
                  hint={`${fmtHours(stats.forecast.breakdown.queueAheadSeconds)} до старта этого проекта`} />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded p-3 mb-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Ещё даже не поставлено в очередь — {fmtHours(stats.forecast.breakdown.notQueuedSeconds)}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400 font-mono">
              {Object.entries(stats.forecast.breakdown.notQueuedStages).map(([stage, n]) => (
                <span key={stage}>{stageLabel(stage)}: <span className="text-zinc-200">{n}</span></span>
              ))}
              {stats.forecast.breakdown.notQueuedBgmSegments > 0 && (
                <span>музыка: <span className="text-zinc-200">{stats.forecast.breakdown.notQueuedBgmSegments}</span></span>
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
  const map: Record<string, string> = {
    scene:             'кадр (SDXL)',
    video:             'видео (i2v)',
    video_post:        'FHD + FPS',
    tts:               'озвучка',
    bgm:               'музыка',
    anchor:            'якорь',
    validation:        'вижн-проверка',
    anchor_validation: 'проверка якоря',
    dataset:           'датасет',
    training:          'LoRA',
    caption:           'субтитры',
  };
  return map[type] ?? type;
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

function Stat({
  label, value, highlight, hint,
}: {
  label:      string;
  value:      string;
  highlight?: boolean;
  hint?:      string;
}) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${highlight ? 'border-emerald-700/60' : ''}`}>
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[10px] text-zinc-600 mt-1 leading-snug">{hint}</div>}
    </div>
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

