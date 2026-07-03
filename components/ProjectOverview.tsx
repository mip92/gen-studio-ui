'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CapcutReadiness, ScenesResponse, DashboardResponse, ProjectFull, ShortsPlan, ShortResult } from '../lib/api';

type Stats = Awaited<ReturnType<typeof api.getProjectStats>>;

export function ProjectOverview({ id }: { id: string }) {
  const [scenes,    setScenes]    = useState<ScenesResponse    | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [readiness, setReadiness] = useState<CapcutReadiness   | null>(null);
  const [shortsPlan, setShortsPlan] = useState<ShortsPlan       | null>(null);
  const [stats,     setStats]     = useState<Stats             | null>(null);
  const [project,   setProject]   = useState<ProjectFull       | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const refreshReadiness = () => {
    api.capcutReadiness(id).then(setReadiness).catch(() => setReadiness(null));
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, d, r, sp, st, pr] = await Promise.all([
          api.listScenes(id),
          api.dashboard(id),
          api.capcutReadiness(id).catch(() => null),
          api.shortsPlan(id).catch(() => null),
          api.getProjectStats(id).catch(() => null),
          api.getProject(id).catch(() => null),
        ]);
        setScenes(s);
        setDashboard(d);
        setReadiness(r);
        setShortsPlan(sp);
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
        <div className="flex flex-col gap-3 w-72 flex-shrink-0">
          <ExportCapcutButton
            projectId={id}
            readiness={readiness}
            onAfterExport={refreshReadiness}
          />
          <ExportShortsButton projectId={id} plan={shortsPlan} />
        </div>
      </div>

      <PublishCard
        projectId={id}
        initialUrl={project?.youtubeUrl ?? null}
        onChange={(url) => setProject((p) => (p ? { ...p, youtubeUrl: url } : p))}
      />

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Статистика пайплайна</h2>
        {!stats ? (
          <p className="text-zinc-500 text-sm">Статистика пока недоступна.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <TimingCard label="SDXL рендер сцены" stat={stats.sceneRender} />
              <TimingCard label="Wan2.2 видео (i2v)" stat={stats.videoRender} />
              <TimingCard label="Видео FHD-апскейл" stat={stats.videoUpscale} />
              <TimingCard label="Озвучка (TTS)" stat={stats.tts} />
              <TimingCard label="Музыка (BGM)" stat={stats.bgm} />
              <TimingCard label="Датасет" stat={stats.dataset} />
              <TimingCard label="LoRA тренировка" stat={stats.training} />
            </div>

            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Перегенерации и удалённое</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="Удалено картинок (~)"
                value={String(stats.waste.estimatedDeleted)}
                hint={`из ~${stats.waste.estimatedGenerated} сгенеренных; сейчас в галерее ${stats.waste.currentImages}`}
              />
              <Stat
                label="Шотов перегенерено"
                value={String(stats.waste.shotsRegenerated)}
                hint={`всего перегенераций: ${stats.waste.totalRegenerations}`}
              />
              <Stat label="Завершённых сцен-рендеров" value={String(stats.sceneRender.count)} />
              <Stat label="Завершённых видео" value={String(stats.videoRender.count)} />
            </div>

            <p className="text-xs text-zinc-600 mt-4">
              «Удалено картинок» — оценка: каждый завершённый сцен-рендер ≈ 5 кадров (batchSize),
              сравниваем с тем что сейчас в <code>renderedImages</code>. «Перегенерации» — шоты у которых
              больше одного завершённого <code>SceneRenderJob</code>.
            </p>
          </>
        )}
      </section>
    </main>
  );
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

function TimingCard({
  label, stat,
}: {
  label: string;
  stat:  { count: number; avgSeconds: number | null };
}) {
  const formatDuration = (s: number | null): string => {
    if (s === null) return '—';
    if (s < 60)   return `${s} сек`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r === 0 ? `${m} мин` : `${m} мин ${r} сек`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm === 0 ? `${h} ч` : `${h} ч ${rm} мин`;
  };
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1">{formatDuration(stat.avgSeconds)}</div>
      <div className="text-[10px] text-zinc-600 mt-1">в среднем по {stat.count} завершённым</div>
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

function ExportCapcutButton({
  projectId,
  readiness,
  onAfterExport,
}: {
  projectId:     string;
  readiness:     CapcutReadiness | null;
  onAfterExport: () => void;
}) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<{ draftPath: string; sceneCount: number; shotCount: number } | null>(null);
  const [err,    setErr]    = useState<string | null>(null);

  const reasonLabel = (r: string) => ({
    no_chosen_video:  'нет утверждённого видео',
    no_upscale:       'нет FHD-апскейла',
    no_interp:        'нет интерполяции FPS',
    no_chosen_render: 'нет утверждённого кадра',
    no_shots:         'в сцене нет кадров',
  } as Record<string, string>)[r] ?? r;

  const totalMissing = (readiness?.missingShots.length ?? 0) + (readiness?.missingScenes.length ?? 0);
  const ready        = readiness?.ready === true;

  const tooltip = ready
    ? 'Все кадры FHD. Жми — соберу draft для CapCut. Per-shot озвучка подтянется автоматически где утверждена.'
    : !readiness
      ? 'Проверяю готовность…'
      : `Не готово: ${totalMissing} пункт${totalMissing === 1 ? '' : 'а'}. См. список ниже.`;

  const onClick = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await api.exportCapcut(projectId);
      setResult(r);
      onAfterExport();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-72 flex-shrink-0">
      <button
        onClick={onClick}
        disabled={!ready || busy}
        title={tooltip}
        className={`w-full px-4 py-2 rounded text-sm font-medium border transition-colors ${ready
          ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-white'
          : 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'}`}
      >
        {busy ? '⏳ собираю draft…' : '🎬 Экспорт в CapCut'}
      </button>
      {readiness && !ready && (
        <div className="mt-2 bg-zinc-950 border border-zinc-800 rounded p-3 text-xs space-y-1.5 max-h-64 overflow-y-auto">
          {readiness.missingScenes.map((s) => (
            // Scene jump-link: /scenes page with the sceneKey anchor. ScenesList
            // already renders an id="<sceneKey>" anchor per card, so the browser
            // scrolls to the right card. From there the user clicks "озвучка".
            <Link
              key={s.sceneId}
              href={`/projects/${projectId}/scenes#${s.sceneKey}`}
              className="flex justify-between gap-2 px-1.5 py-1 -mx-1.5 rounded hover:bg-zinc-900 transition-colors"
              title={`Открыть сцену ${s.sceneKey} → добавить кадры`}
            >
              <span className="text-zinc-300 hover:text-blue-300">сцена {s.sceneKey}</span>
              <span className="text-amber-300 text-[10px]">{reasonLabel(s.reason)} →</span>
            </Link>
          ))}
          {readiness.missingShots.map((s) => (
            // Shot jump-link: each row points to the shot's right tab depending
            // on what is missing — videos tab if no chosen video or no upscale
            // yet, because both fixes happen on that page.
            <Link
              key={s.shotId}
              href={`/projects/${projectId}/shots/${s.shotId}/videos`}
              className="flex justify-between gap-2 px-1.5 py-1 -mx-1.5 rounded hover:bg-zinc-900 transition-colors"
              title={`Открыть видео кадра ${s.shotCode}`}
            >
              <span className="text-zinc-300 font-mono hover:text-blue-300">{s.shotCode}</span>
              <span className="text-amber-300 text-[10px]">{reasonLabel(s.reason)} →</span>
            </Link>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-red-400 text-xs font-mono whitespace-pre-wrap break-all">{err}</p>}
      {result && (
        <div className="mt-2 bg-emerald-950/40 border border-emerald-700 rounded p-3 text-xs space-y-1">
          <p className="text-emerald-300">✓ draft создан — {result.sceneCount} сцен, {result.shotCount} кадров</p>
          <code className="block text-emerald-200 font-mono break-all bg-black/30 p-1.5 rounded text-[10px]">
            {result.draftPath}
          </code>
          <p className="text-zinc-400">
            Скопируй эту папку в <code>%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\</code>.
            Откроется в списке проектов CapCut.
          </p>
        </div>
      )}
    </div>
  );
}

// Build the project's vertical (9:16) YouTube-Shorts CapCut drafts — one per
// short — from the curated plan (scripts/<slug>_shorts_plan.json). Sibling of
// ExportCapcutButton; enabled only when a plan exists. For now the plan is
// hand-authored; a local LLM will pick the intriguing shots later.
function ExportShortsButton({
  projectId,
  plan,
}: {
  projectId: string;
  plan:      ShortsPlan | null;
}) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<{ shorts: ShortResult[] } | null>(null);
  const [err,    setErr]    = useState<string | null>(null);

  const has   = plan?.hasPlan === true;
  const count = plan?.shorts.length ?? 0;

  const tooltip = has
    ? `Соберу ${count} вертикальных шортса (9:16) из готовых кадров — по одному CapCut-драфту на шорт.`
    : !plan
      ? 'Загружаю план шортсов…'
      : 'Нет плана шортсов. Создай scripts/<slug>_shorts_plan.json (какие кадры в каждый шорт).';

  const onClick = async () => {
    if (!has || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      setResult(await api.exportShorts(projectId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={onClick}
        disabled={!has || busy}
        title={tooltip}
        className={`w-full px-4 py-2 rounded text-sm font-medium border transition-colors ${has
          ? 'bg-fuchsia-800 hover:bg-fuchsia-700 border-fuchsia-600 text-white'
          : 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'}`}
      >
        {busy ? '⏳ собираю шортсы…' : has ? `📱 Экспорт шортсов (${count})` : '📱 Нет плана шортсов'}
      </button>
      {has && !result && !busy && (
        <div className="mt-2 text-[11px] text-zinc-400 space-y-0.5">
          {plan!.shorts.map((s) => (
            <div key={s.slug} className="flex justify-between gap-2">
              <span className="text-zinc-300 truncate">{s.title}</span>
              <span className="text-zinc-500 flex-shrink-0">{s.shots} кадров</span>
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-red-400 text-xs font-mono whitespace-pre-wrap break-all">{err}</p>}
      {result && (
        <div className="mt-2 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-3 text-xs space-y-1.5">
          <p className="text-fuchsia-300">✓ собрано шортсов: {result.shorts.length}</p>
          {result.shorts.map((s) => (
            <div key={s.draft_name} className="space-y-0.5">
              <p className="text-fuchsia-200">{s.title ?? s.slug} — {s.shots} кадров, ~{s.seconds}с</p>
              <code className="block text-fuchsia-100/80 font-mono break-all bg-black/30 p-1 rounded text-[10px]">
                {s.draft_path ?? s.draft_name}
              </code>
            </div>
          ))}
          <p className="text-zinc-400">Уже в списке проектов CapCut (папки в com.lveditor.draft).</p>
        </div>
      )}
    </div>
  );
}
