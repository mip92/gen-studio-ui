'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ScenesResponse, SceneShot, SceneShotParticipant } from '../lib/api';
import { CreateSceneModal } from './CreateSceneModal';
import { CreateShotModal } from './CreateShotModal';
import { SceneShotsTTSModal } from './SceneShotsTTSModal';
import { useScrollRestore } from '../lib/useScrollRestore';

export function ScenesList({ id }: { id: string }) {
  const markBeforeNav = useScrollRestore(`scenes-list:${id}`);

  const [data, setData]                           = useState<ScenesResponse | null>(null);
  const [error, setError]                         = useState<string | null>(null);
  const [showCreate, setShowCreate]               = useState(false);
  const [createShotInScene, setCreateShotInScene] = useState<string | null>(null);
  const [ttsForScene, setTtsForScene]             = useState<string | null>(null);
  const [queue, setQueue] = useState<{ running: string[]; pending: string[] } | null>(null);

  const refresh = useCallback(() => {
    api.listScenes(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api.comfyQueue().then(setQueue).catch(() => setQueue(null));
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error)  return <main className="px-8 py-6 max-w-7xl mx-auto"><div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div></main>;
  if (!data)  return <main className="px-8 py-6 max-w-7xl mx-auto text-zinc-500">Loading…</main>;

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500">Сцены и кадры</h2>
          {queue && (queue.running.length > 0 || queue.pending.length > 0) && (
            <span className="text-xs text-amber-300 bg-amber-900/30 border border-amber-800/50 rounded px-2 py-0.5">
              ComfyUI: ⚙ {queue.running.length} · ⏳ {queue.pending.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded"
        >
          + новая сцена
        </button>
      </div>

      {showCreate && (
        <CreateSceneModal
          projectId={id}
          existingCount={data.scenes.length}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      <div className="space-y-6">
        {data.scenes.map((s) => (
          <article key={s.id} id={s.sceneKey} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <header className="px-5 py-3 border-b border-zinc-800 flex items-baseline justify-between">
              <h3 className="font-medium">
                <span className="text-zinc-500 text-xs font-mono mr-2">#{s.sortOrder}</span>
                {s.title ?? s.sceneKey}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">
                  {s.shots.length} кадров · фото: {s.shots.filter((sh) => sh.chosenRender).length} · видео: {s.shots.filter((sh) => sh.chosenVideoId).length}
                </span>
                <button
                  onClick={() => setTtsForScene(s.id)}
                  title="Озвучка кадров сцены — по одному ~5с wav на шот"
                  className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-0.5 rounded"
                >
                  🔊 озвучка ({s.shots.filter((sh) => (sh as { narrationText?: string | null }).narrationText).length}/{s.shots.length})
                </button>
                <button
                  onClick={() => setCreateShotInScene(s.id)}
                  className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5 rounded"
                >
                  + кадр
                </button>
              </div>
            </header>
            <div className="divide-y divide-zinc-800">
              {s.shots.map((sh) => (
                <ShotRow
                  key={sh.id}
                  projectId={id}
                  shot={sh}
                  queueStatus={queueStatusFor(sh, queue)}
                  onEnqueued={refresh}
                  markBeforeNav={markBeforeNav}
                />
              ))}
            </div>
          </article>
        ))}
      </div>

      {createShotInScene && (
        <CreateShotModal
          projectId={id}
          sceneId={createShotInScene}
          existingShotCount={data.scenes.find((s) => s.id === createShotInScene)?.shots.length ?? 0}
          onClose={() => setCreateShotInScene(null)}
          onCreated={() => { setCreateShotInScene(null); refresh(); }}
        />
      )}

      {ttsForScene && (() => {
        const s = data.scenes.find((sc) => sc.id === ttsForScene);
        if (!s) return null;
        return (
          <SceneShotsTTSModal
            sceneId={s.id}
            sceneTitle={s.title ?? s.sceneKey}
            shots={s.shots}
            onClose={() => { setTtsForScene(null); refresh(); }}
          />
        );
      })()}
    </main>
  );
}

type QueueStatus = 'idle' | 'running' | 'pending';

function queueStatusFor(shot: SceneShot, queue: { running: string[]; pending: string[] } | null): QueueStatus {
  // Source of truth #1: our pipeline queue (covers pending — not yet dispatched —
  // and running scenes; legacy direct renders won't have this set).
  if (shot.pipelineRender) {
    if (shot.pipelineRender.status === 'running') return 'running';
    if (shot.pipelineRender.status === 'pending') return 'pending';
  }
  // Source of truth #2: raw ComfyUI queue, for shots that bypassed the pipeline
  // (e.g. dry-runs, direct /render calls before we added the queue).
  const id = shot.activeRenderPromptId;
  if (!id || !queue) return 'idle';
  if (queue.running.includes(id)) return 'running';
  if (queue.pending.includes(id)) return 'pending';
  return 'idle';
}

function ShotRow({ projectId, shot, queueStatus, onEnqueued, markBeforeNav }: {
  projectId: string;
  shot: SceneShot;
  queueStatus: QueueStatus;
  onEnqueued: () => void;
  markBeforeNav: (targetId?: string) => void;
}) {
  const router            = useRouter();
  const [busy,    setBusy]    = useState<false | 'one' | 'five' | 'video' | 'upscale'>(false);
  const [enqueueErr, setErr]  = useState<string | null>(null);

  // Render is allowed iff every bound participant has a trained LoRA.
  // 0-participant shots (environment) are renderable. unbound (silhouette)
  // participants are okay — they don't need a LoRA.
  const blocked        = shot.participants.some((p) => p.characterCode && !p.loraReady);
  const idle           = queueStatus === 'idle';
  const photoApproved  = !!shot.chosenRender;
  const videoApproved  = !!shot.chosenVideoId;
  const canRender      = idle && !blocked;

  // Video-side state — what badge/button to surface on this row.
  const videoStatus    = shot.pipelineVideo?.status   ?? null;   // pending|running|null
  const upscaleStatus  = shot.pipelineUpscale?.status
                       ?? shot.chosenVideo?.upscaleStatus
                       ?? null;
  const fhdReady       = shot.chosenVideo?.upscaleStatus === 'completed'
                       && !!shot.chosenVideo?.upscaledFilename;

  const enqueue = async (n: number, tag: 'one' | 'five') => {
    setBusy(tag);
    setErr(null);
    try {
      for (let i = 0; i < n; i++) {
        await api.enqueueShotRender(shot.id, { seed: Math.floor(Math.random() * 2 ** 32) });
      }
      onEnqueued();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enqueueVideo = async () => {
    setBusy('video');
    setErr(null);
    try {
      await api.startVideoRender(shot.id, {});
      onEnqueued();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enqueueUpscale = async () => {
    if (!shot.chosenVideoId) return;
    setBusy('upscale');
    setErr(null);
    try {
      await api.upscaleVideo(shot.chosenVideoId);
      onEnqueued();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div
      data-scroll-key={shot.id}
      onClick={() => { markBeforeNav(shot.id); router.push(`/projects/${projectId}/shots/${shot.id}`); }}
      className={`px-5 py-3 flex gap-4 text-sm hover:bg-zinc-800/30 transition items-start cursor-pointer ${
        queueStatus !== 'idle' || videoStatus || upscaleStatus === 'pending' || upscaleStatus === 'running'
          ? 'bg-amber-950/20'
          : ''
      }`}
    >
      {/* Thumbnail of chosen render */}
      <div className="w-24 h-16 flex-shrink-0 bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex items-center justify-center">
        {shot.chosenRender ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={api.shotImageUrl(shot.id, shot.chosenRender)}
            alt={shot.chosenRender}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : shot.rendersCount > 0 ? (
          <span className="text-[10px] text-zinc-500 text-center px-1">
            {shot.rendersCount} вар.<br/>не выбран
          </span>
        ) : (
          <span className="text-[10px] text-zinc-700">—</span>
        )}
      </div>

      {/* Code + beat */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <span className="text-zinc-500 font-mono text-xs">{shot.shotCode}</span>
          {queueStatus === 'running' && (
            <span className="text-blue-300 bg-blue-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⚙ рендерится</span>
          )}
          {queueStatus === 'pending' && (
            <span className="text-amber-300 bg-amber-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⏳ в очереди</span>
          )}
          {shot.chosenRender && (
            <span className="text-emerald-400 text-[10px] uppercase tracking-wider">✓ photo</span>
          )}
          {!shot.chosenRender && shot.rendersCount > 0 && (
            <span className="text-amber-400 text-[10px] uppercase tracking-wider">{shot.rendersCount} draft</span>
          )}
          {/* Video badges — mirror photo flow. */}
          {videoStatus === 'running' && (
            <span className="text-blue-300 bg-blue-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⚙ видео</span>
          )}
          {videoStatus === 'pending' && (
            <span className="text-amber-300 bg-amber-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⏳ видео</span>
          )}
          {videoApproved && (
            <span className="text-emerald-400 text-[10px] uppercase tracking-wider">🎬 video ✓</span>
          )}
          {!videoApproved && shot.videosCount > 0 && (
            <span className="text-amber-400 text-[10px] uppercase tracking-wider">🎬 {shot.videosCount} draft</span>
          )}
          {fhdReady && (
            <span className="text-emerald-300 bg-emerald-900/30 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">FHD ✓</span>
          )}
          {upscaleStatus === 'running' && (
            <span className="text-blue-300 bg-blue-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⚙ FHD</span>
          )}
          {upscaleStatus === 'pending' && (
            <span className="text-amber-300 bg-amber-900/40 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">⏳ FHD</span>
          )}
          {shot.cameraFraming && (
            <span className="text-zinc-500 bg-zinc-800/60 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono">
              📷 {shot.cameraFraming}
            </span>
          )}
        </div>
        <div className="text-zinc-300 line-clamp-2">{shot.beat ?? <em className="text-zinc-600">нет описания</em>}</div>
        {shot.location && <div className="text-zinc-500 text-xs mt-0.5">📍 {shot.location}</div>}
        {enqueueErr && (
          <div className="text-red-400 text-xs mt-1">{enqueueErr}</div>
        )}
      </div>

      {/* Participants — profile chips with LoRA status */}
      {shot.participants.length > 0 && (
        <div className="flex flex-col gap-1 flex-shrink-0 max-w-[260px]">
          {shot.participants.map((p) => (
            <ProfileChip key={p.id} p={p} />
          ))}
        </div>
      )}

      {/* Action buttons — three-stage flow mirroring the photo approval:
            1) no photo approved          → render photos
            2) photo approved, no video   → render video
            3) video approved, no FHD     → upscale to FHD
            4) FHD ready / in-flight FHD  → no button (badge tells the story) */}
      <div onClick={stop} className="flex flex-col gap-1 flex-shrink-0">
        {videoApproved ? (
          fhdReady || upscaleStatus === 'running' || upscaleStatus === 'pending' ? null : (
            <button
              onClick={(e) => { stop(e); enqueueUpscale(); }}
              disabled={busy !== false}
              title="Прогнать выбранное видео через 4x-UltraSharp → 1920×1080"
              className="text-[11px] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded whitespace-nowrap"
            >
              {busy === 'upscale' ? '⏳ FHD…' : '🔼 апскейл FHD'}
            </button>
          )
        ) : photoApproved ? (
          <button
            onClick={(e) => { stop(e); enqueueVideo(); }}
            disabled={busy !== false}
            title="Поставить рендер видео (Wan2.2 i2v) в очередь"
            className="text-[11px] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded whitespace-nowrap"
          >
            {busy === 'video' ? '⏳ видео…' : shot.videosCount > 0 ? `+ ещё видео (${shot.videosCount})` : '🎬 рендер видео'}
          </button>
        ) : (
          <>
            <button
              onClick={(e) => { stop(e); enqueue(1, 'one'); }}
              disabled={!canRender || busy !== false}
              title={blocked ? 'Не все LoRA готовы' : queueStatus !== 'idle' ? 'Уже в очереди' : 'Один рендер (5 вариантов)'}
              className="text-[11px] bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded whitespace-nowrap"
            >
              {busy === 'one' ? '⏳' : shot.rendersCount > 0 ? `+ 5 вар. (${shot.rendersCount})` : '🚀 рендер'}
            </button>
            <button
              onClick={(e) => { stop(e); enqueue(5, 'five'); }}
              disabled={!canRender || busy !== false}
              title="Поставить 5 рендеров с разными seed в очередь"
              className="text-[11px] bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded whitespace-nowrap"
            >
              {busy === 'five' ? '⏳ 5×' : '× 5 в очередь'}
            </button>
          </>
        )}
      </div>

      <Link
        href={`/projects/${projectId}/shots/${shot.id}`}
        onClick={(e) => { stop(e); markBeforeNav(shot.id); router.push(`/projects/${projectId}/shots/${shot.id}`); }}
        className="text-zinc-700 text-xs pt-0.5 hover:text-zinc-400"
      >
        →
      </Link>
    </div>
  );
}

function ProfileChip({ p }: { p: SceneShotParticipant }) {
  // unbound participant — silhouette / extra (no LoRA needed)
  if (!p.characterCode) {
    return (
      <span className="text-[10px] bg-zinc-800/60 text-zinc-500 px-2 py-0.5 rounded inline-flex items-center gap-1 italic">
        ○ {p.label} (силуэт)
      </span>
    );
  }
  // No profile resolved yet
  if (!p.profileCode) {
    return (
      <span className="text-[10px] bg-red-900/40 text-red-300 px-2 py-0.5 rounded inline-flex items-center gap-1">
        ✕ {p.characterCode} — нет профиля
      </span>
    );
  }
  // Profile resolved — green if LoRA ready, amber if not
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${
        p.loraReady
          ? 'bg-emerald-900/40 text-emerald-300'
          : 'bg-amber-900/40 text-amber-300'
      }`}
      title={`${p.characterDisplayName ?? p.characterCode} → ${p.profileCode}${p.profileAgeLabel ? ' (' + p.profileAgeLabel + ')' : ''}`}
    >
      {p.loraReady ? '✓' : '⚠'} {p.profileCode}
      {p.profileAgeLabel && <span className="text-zinc-500 ml-0.5">·{p.profileAgeLabel}</span>}
      {!p.chosenExplicitly && <span className="text-zinc-500 ml-0.5">авто</span>}
    </span>
  );
}
