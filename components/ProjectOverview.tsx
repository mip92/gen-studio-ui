'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CapcutReadiness, ScenesResponse, DashboardResponse } from '../lib/api';

export function ProjectOverview({ id }: { id: string }) {
  const [scenes,    setScenes]    = useState<ScenesResponse    | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [readiness, setReadiness] = useState<CapcutReadiness   | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const refreshReadiness = () => {
    api.capcutReadiness(id).then(setReadiness).catch(() => setReadiness(null));
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, d, r] = await Promise.all([
          api.listScenes(id),
          api.dashboard(id),
          api.capcutReadiness(id).catch(() => null),
        ]);
        setScenes(s);
        setDashboard(d);
        setReadiness(r);
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
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <Stat label="Сцены"      value={String(scenes.scenes.length)} />
          <Stat label="Кадры"      value={String(totalShots)} />
          <Stat label="Персонажи"  value={String(total)} />
          <Stat label="LoRA готовы" value={`${ready} / ${total}`} highlight={ready > 0} />
        </section>
        <ExportCapcutButton
          projectId={id}
          readiness={readiness}
          onAfterExport={refreshReadiness}
        />
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Сценарий</h2>
        <div className="space-y-4">
          {scenes.scenes.map((s) => (
            <article key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="font-medium">
                  <span className="text-zinc-500 text-xs font-mono mr-2">#{s.sortOrder}</span>
                  {s.title ?? s.sceneKey}
                </h3>
                <Link
                  href={`/projects/${id}/scenes#${s.sceneKey}`}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {s.shots.length} кадров →
                </Link>
              </header>
              <ol className="space-y-1 text-sm text-zinc-300">
                {s.shots.slice(0, 5).map((sh) => (
                  <li key={sh.id} className="flex gap-2">
                    <span className="text-zinc-600 font-mono text-xs w-20 flex-shrink-0">{sh.shotCode}</span>
                    <span className="flex-1">{sh.beat ?? <em className="text-zinc-600">(нет описания)</em>}</span>
                    {sh.participants.length > 0 && (
                      <span className="text-xs text-zinc-500 flex-shrink-0">
                        {sh.participants.map((p) => p.characterCode ?? '—').join(', ')}
                      </span>
                    )}
                  </li>
                ))}
                {s.shots.length > 5 && (
                  <li className="text-xs text-zinc-600 pl-22">
                    + ещё {s.shots.length - 5} кадров
                  </li>
                )}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({
  label, value, highlight,
}: {
  label:      string;
  value:      string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${highlight ? 'border-emerald-700/60' : ''}`}>
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <main className="px-8 py-6 max-w-7xl mx-auto">{children}</main>;
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
