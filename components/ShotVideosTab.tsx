'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, VideoRender } from '../lib/api';
import { useShotCtx } from './ShotPageShell';
import { useScrollRestore } from '../lib/useScrollRestore';

export function ShotVideosTab() {
  const { shot, setShot, projectId, shotId, reload } = useShotCtx();
  const markBeforeNav = useScrollRestore(`videos-grid:${shotId}`);

  // Pre-fill from the shot's baked motion direction in the DB
  // (promptFields.motionPrompt) so what's stored is visible & editable — the
  // backend already falls back to it at render time, but the user couldn't see
  // it before. Re-sync only when navigating to a different shot so we never
  // clobber what the user is typing for the current one.
  const [motionPrompt, setMotionPrompt] = useState(shot.promptFields?.motionPrompt ?? '');
  useEffect(() => { setMotionPrompt(shot.promptFields?.motionPrompt ?? ''); }, [shotId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [count, setCount]               = useState(1);
  // Default = «страж» (user call 2026-07-30): the fast graph with cfg 2.5 on the
  // high-noise sampler, so the negative prompt is actually evaluated on the pass
  // that decides what is in the frame. Costs +31 % (~196 s vs 150 s) — cheap
  // next to «качество» at 6.5×, and it is meant to pay for itself by cutting the
  // re-renders caused by figures walking into a shot. «быстро» stays one click
  // away. Keep this in sync with resolveWorkflowFilename's fallback in
  // video-render.service.ts — that is what scripted bulk enqueues get.
  const [mode, setMode]                 = useState<'fast' | 'guard' | 'cfg'>('guard');
  const [videos, setVideos]             = useState<VideoRender[] | null>(null);
  const [busy, setBusy]                 = useState<false | 'start'>(false);
  const [error, setError]               = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedTick, setSavedTick]       = useState(false);

  // The stored, persistent motion prompt of the shot (promptFields.motionPrompt).
  // The textarea is a per-render override that pre-fills from it; "save as shot
  // prompt" persists the current text back so it's reused by every future render.
  const storedMotion = (shot.promptFields?.motionPrompt as string | undefined) ?? '';
  const isDirty = motionPrompt.trim() !== storedMotion.trim();

  const saveToShot = async () => {
    setSavingPrompt(true); setError(null); setSavedTick(false);
    try {
      const updated = await api.updateShot(shotId, {
        promptFields: { ...(shot.promptFields ?? {}), motionPrompt: motionPrompt.trim() },
      });
      setShot(updated);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSavingPrompt(false); }
  };

  const refresh = useCallback(() => {
    api.listVideosForShot(shotId).then(setVideos).catch(() => setVideos([]));
  }, [shotId]);

  const approve = useCallback(async (videoId: string | null) => {
    try {
      await api.setChosenVideo(shotId, videoId);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [shotId, reload]);

  const deleteVideo = useCallback(async (videoId: string) => {
    if (!confirm('Удалить это видео навсегда? Файл (preview + FHD) будет стёрт с диска.')) return;
    try {
      await api.deleteVideo(videoId);
      refresh();
      // Reload shot ctx in case chosenVideoId pointed at the deleted clip.
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [refresh, reload]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll the videos list while anything is in flight (render or upscale).
  useEffect(() => {
    if (!videos) return;
    const inFlight = videos.some(
      (v) => v.status === 'pending' || v.status === 'running' ||
             v.upscaleStatus === 'pending' || v.upscaleStatus === 'running',
    );
    if (!inFlight) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [videos, refresh]);

  if (shot.renderMode === 'static') {
    return (
      <main className="px-4 sm:px-8 py-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-zinc-400 text-sm">
            Кадр <code className="text-zinc-300">{shot.shotCode}</code> помечен как статичный (<code className="text-zinc-300">renderMode=static</code>) — генерация видео для него отключена. В экспорте он анимируется эффектом Ken Burns из выбранного рендера.
          </p>
          <p className="text-zinc-500 text-xs mt-2">
            Чтобы снять клип, переключите кадр в режим <code className="text-zinc-400">animated</code>.
          </p>
        </section>
      </main>
    );
  }

  if (!shot.chosenRender) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-zinc-400 text-sm">
            Сначала выберите финальный рендер на вкладке <Link href={`/projects/${projectId}/shots/${shotId}/render`} className="text-blue-400 hover:text-blue-300">Рендер кадра</Link> — он пойдёт первым кадром видео.
          </p>
        </section>
      </main>
    );
  }

  const start = async () => {
    setBusy('start'); setError(null);
    try {
      await api.startVideoRender(shotId, {
        motionPrompt: motionPrompt.trim() || undefined,
        count,
        mode,
      });
      // Reset to the DB-baked value (not blank) so the field keeps showing the
      // shot's stored motion direction after queuing.
      setMotionPrompt(shot.promptFields?.motionPrompt ?? '');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <main className="px-4 sm:px-8 py-6">
      {/* Launcher */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Запустить новый рендер</h3>

        <p className="text-zinc-500 text-xs mb-2">
          Первый кадр: <code className="text-zinc-300">{shot.chosenRender}</code> · 768×432 (точные 16:9) · 81 кадр · 16 fps (~5 сек) · апскейл в FHD по кнопке в деталях видео
        </p>

        <textarea
          value={motionPrompt}
          rows={3}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="Motion prompt — что должно происходить в кадре (движение тела, камера). Предзаполнен сохранённым промптом кадра; можно оставить пустым."
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono mb-2"
        />

        {/* Persist the current text back to the shot so it becomes the default for
            every future render (otherwise the textarea is a one-off override). */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={saveToShot}
            disabled={savingPrompt || !isDirty}
            title="Записать этот промпт в кадр (promptFields.motionPrompt) — станет промптом по умолчанию для всех будущих рендеров"
            className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded"
          >
            {savingPrompt ? '…' : '💾 сохранить как промпт кадра'}
          </button>
          {savedTick && <span className="text-emerald-400 text-xs">✓ сохранено в кадр</span>}
          {isDirty && !savedTick && <span className="text-amber-400 text-xs">● отличается от сохранённого в кадре</span>}
          {!isDirty && !savedTick && <span className="text-zinc-600 text-xs">совпадает с сохранённым промптом кадра</span>}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={start}
            disabled={busy !== false}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
          >
            {busy === 'start' ? '⏳ ставим в очередь…' : `🎬 рендерить ${count > 1 ? `${count} видео` : 'видео'}`}
          </button>
          <label className="flex items-center gap-1 text-zinc-400 text-xs">
            количество
            <input
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              className="w-14 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 text-center"
            />
          </label>
          <label className="flex items-center gap-1 text-zinc-400 text-xs">
            режим
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'fast' | 'guard' | 'cfg')}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
            >
              <option value="guard">страж (по умолчанию — негатив на 1-м проходе, ~3.3 мин)</option>
              <option value="fast">быстро (4-step, ~2.5 мин, негатив НЕ работает)</option>
              <option value="cfg">качество (cfg=4, ~16 мин, 6.5× медленнее)</option>
            </select>
          </label>
          {error && <span className="text-red-400 text-xs">{error}</span>}
        </div>
        <p className="text-zinc-600 text-[11px] mt-2 leading-relaxed">
          {mode === 'fast'
            ? 'Быстрый режим (по умолчанию): lightx2v full-distill fp8, 4 шага, cfg=1.0, медиана 150 с. При cfg=1 ComfyUI вообще не считает негативную ветку — motionNegative не игнорируется «слабо», его нет. Движение задаётся ТОЛЬКО позитивным промптом.'
            : mode === 'guard'
            ? 'Страж: тот же быстрый граф, но cfg=2.5 на ВЫСОКОШУМНОМ проходе (шаги 0–2); низкошумный остаётся на cfg=1. Высокошумный эксперт решает композицию — что вообще есть в кадре, — поэтому именно там негатив может не пустить лишнюю фигуру. 6 прогонов модели вместо 4, оценка ~196 с. Брать, когда в клип лезут люди/аниме.'
            : 'Режим качества: полный Wan 2.2 без дистилляции, 20 шагов, cfg=4.0 на обоих экспертах, 40 прогонов. Замеренная медиана 980 с — в 6.5 раза дольше быстрого. Брать точечно.'}
        </p>
      </section>

      {/* Grid of all videos */}
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">Сгенерированные видео</h3>
        {videos && <span className="text-xs text-zinc-600">всего {videos.length}</span>}
      </div>

      {videos === null && <p className="text-zinc-500 text-sm">Loading…</p>}
      {videos && videos.length === 0 && (
        <p className="text-zinc-600 text-sm italic">Пока ничего не нагенерировано.</p>
      )}
      {videos && videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              projectId={projectId}
              shotId={shotId}
              markBeforeNav={markBeforeNav}
              isChosen={shot.chosenVideoId === v.id}
              onApprove={approve}
              onDelete={deleteVideo}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function VideoCard({ video, projectId, shotId, markBeforeNav, isChosen, onApprove, onDelete }: {
  video: VideoRender;
  projectId: string;
  shotId: string;
  markBeforeNav: (targetId?: string) => void;
  isChosen: boolean;
  onApprove: (videoId: string | null) => Promise<void>;
  onDelete: (videoId: string) => Promise<void>;
}) {
  const params = video.params ?? {};
  const isReady = video.status === 'completed' && video.outputFilename;
  const hasFhd  = video.upscaleStatus === 'completed' && video.upscaledFilename;

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <Link
      href={`/projects/${projectId}/shots/${shotId}/videos/${video.id}`}
      onClick={() => markBeforeNav(video.id)}
      className={`block bg-zinc-900 border rounded overflow-hidden ${
        isChosen
          ? 'border-emerald-500 ring-2 ring-emerald-500/40'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
      data-scroll-key={video.id}
    >
      <div className="aspect-video bg-black flex items-center justify-center relative">
        {isReady ? (
          <video
            src={api.videoFileUrl(video.id)}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLVideoElement; el.pause(); el.currentTime = 0; }}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-zinc-600 text-xs">
            <StatusBadge status={video.status} />
          </div>
        )}
        <span className="absolute top-2 left-2">
          <StatusBadge status={video.status} />
        </span>
        {hasFhd && (
          <span className="absolute top-2 right-2 bg-emerald-700/90 text-white text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
            FHD ✓
          </span>
        )}
        {isChosen && !hasFhd && (
          <span className="absolute top-2 right-2 bg-emerald-700/90 text-white text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
            ✓ финал
          </span>
        )}
        {/* Approve toggle — only meaningful for a completed clip. */}
        {isReady && (
          <button
            onClick={(e) => { stop(e); onApprove(isChosen ? null : video.id); }}
            className={`absolute bottom-2 right-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
              isChosen
                ? 'bg-zinc-700/90 hover:bg-zinc-600 text-zinc-200'
                : 'bg-emerald-700/90 hover:bg-emerald-600 text-white'
            }`}
            title={isChosen ? 'Снять как финальное' : 'Выбрать как финальное видео кадра'}
          >
            {isChosen ? '○ снять' : '✓ выбрать'}
          </button>
        )}
        <button
          onClick={(e) => { stop(e); onDelete(video.id); }}
          className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-red-900/80 hover:bg-red-700 text-white"
          title="Удалить видео (DB + файл с диска)"
        >
          ✕ удалить
        </button>
      </div>

      <div className="p-3 text-xs space-y-1">
        <div className="text-zinc-400 font-mono">
          {new Date(video.queuedAt).toLocaleString()}
        </div>
        <div className="text-zinc-500 flex items-center gap-2 flex-wrap">
          <span>{(params.width ?? '?')}×{(params.height ?? '?')} · {params.length ?? '?'}f @ {params.fps ?? '?'}fps · seed {params.seed ?? '—'}</span>
          {video.workflowFilename === 'video_wan22_i2v_cfg_api.json' && (
            <span className="bg-purple-900/60 text-purple-200 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" title="Полный Wan 2.2, cfg=4 — негатив работает">cfg</span>
          )}
        </div>
        <div className="text-zinc-300 truncate" title={video.motionPrompt}>
          {video.motionPrompt || <em className="text-zinc-600">no prompt</em>}
        </div>
        {video.status === 'failed' && video.errorMessage && (
          <div className="text-red-400 truncate" title={video.errorMessage}>{video.errorMessage}</div>
        )}
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: VideoRender['status'] }) {
  const map: Record<VideoRender['status'], { label: string; cls: string }> = {
    pending:   { label: '⏳ pending',   cls: 'text-amber-300 bg-amber-900/40' },
    running:   { label: '⚙ running',   cls: 'text-blue-300 bg-blue-900/40' },
    completed: { label: '✓ completed', cls: 'text-emerald-300 bg-emerald-900/40' },
    failed:    { label: '✕ failed',    cls: 'text-red-300 bg-red-900/40' },
    cancelled: { label: '○ cancelled', cls: 'text-zinc-400 bg-zinc-800/40' },
  };
  const m = map[status] ?? { label: status, cls: 'text-zinc-300 bg-zinc-800/40' };
  return <span className={`${m.cls} text-[10px] uppercase tracking-wider px-2 py-0.5 rounded`}>{m.label}</span>;
}

