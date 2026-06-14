'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, VideoRender } from '../lib/api';

export function VideoDetail({
  projectId, shotId, videoId,
}: {
  projectId: string; shotId: string; videoId: string;
}) {
  const router                          = useRouter();
  const [video,        setVideo]        = useState<VideoRender | null>(null);
  const [chosenVideoId, setChosenVideoId] = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [upscaleBusy,  setUpscaleBusy]  = useState(false);
  const [upscaleError, setUpscaleError] = useState<string | null>(null);
  const [approveBusy,  setApproveBusy]  = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [deleteBusy,   setDeleteBusy]   = useState(false);

  const load = useCallback(() => {
    Promise.all([api.getVideo(videoId), api.getShot(shotId)])
      .then(([v, s]) => { setVideo(v); setChosenVideoId(s.chosenVideoId ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [videoId, shotId]);

  useEffect(() => { load(); }, [load]);

  // Live-refresh while either the render OR the upscale is in flight.
  useEffect(() => {
    if (!video) return;
    const renderInFlight  = video.status === 'pending' || video.status === 'running';
    const upscaleInFlight = video.upscaleStatus === 'pending' || video.upscaleStatus === 'running';
    if (!renderInFlight && !upscaleInFlight) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [video, load]);

  const startUpscale = async () => {
    setUpscaleBusy(true); setUpscaleError(null);
    try {
      const updated = await api.upscaleVideo(videoId);
      setVideo(updated);
    } catch (e) {
      setUpscaleError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpscaleBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!video) return;
    if (!confirm('Удалить это видео навсегда? Файл (preview + FHD) будет стёрт с диска.')) return;
    setDeleteBusy(true);
    try {
      await api.deleteVideo(video.id);
      router.push(`/projects/${projectId}/shots/${shotId}/videos`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setDeleteBusy(false);
    }
  };

  const toggleApprove = async () => {
    if (!video) return;
    const willApprove = chosenVideoId !== video.id;
    setApproveBusy(true); setApproveError(null);
    try {
      const updated = await api.setChosenVideo(shotId, willApprove ? video.id : null);
      setChosenVideoId(updated.chosenVideoId ?? null);
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproveBusy(false);
    }
  };

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6 max-w-5xl mx-auto">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!video) return <main className="px-4 sm:px-8 py-6 max-w-5xl mx-auto text-zinc-500">Loading…</main>;

  const params = video.params ?? {};

  return (
    <main className="px-4 sm:px-8 py-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold text-zinc-200">Видео-рендер</h1>
        <span className="font-mono text-xs text-zinc-500">{video.id.slice(0, 8)}</span>
        <StatusBadge status={video.status} />
        <button
          onClick={handleDelete}
          disabled={deleteBusy}
          title="Удалить видео (DB + файл с диска)"
          className="ml-auto text-xs bg-red-900/80 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-3 py-1 rounded"
        >
          {deleteBusy ? '⏳…' : '✕ удалить'}
        </button>
      </div>

      {/* Video player when ready */}
      {video.status === 'completed' && video.outputFilename && (
        <video
          src={api.videoFileUrl(video.id)}
          controls
          loop
          className={`w-full bg-black rounded mb-4 ${chosenVideoId === video.id ? 'ring-2 ring-emerald-500/60' : ''}`}
        />
      )}

      {/* Approve toggle — mirrors photo "выбрать как финальное". Drives the
          /scenes flow: once approved, the row offers an upscale instead of
          another render. */}
      {video.status === 'completed' && (
        <section className="bg-zinc-900 border border-zinc-800 rounded p-4 mb-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={toggleApprove}
            disabled={approveBusy}
            className={`${
              chosenVideoId === video.id
                ? 'bg-zinc-700 hover:bg-zinc-600'
                : 'bg-emerald-700 hover:bg-emerald-600'
            } disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded`}
          >
            {approveBusy
              ? '⏳…'
              : chosenVideoId === video.id
                ? '○ снять выбор'
                : '✓ выбрать как финальное'}
          </button>
          {chosenVideoId === video.id && (
            <span className="text-emerald-400 text-sm">Это финальное видео для кадра.</span>
          )}
          {chosenVideoId && chosenVideoId !== video.id && (
            <span className="text-zinc-500 text-xs">
              Другое видео уже выбрано —{' '}
              <Link
                href={`/projects/${projectId}/shots/${shotId}/videos/${chosenVideoId}`}
                className="text-blue-400 hover:text-blue-300"
              >
                открыть
              </Link>
              .
            </span>
          )}
          {approveError && <span className="text-red-400 text-xs">{approveError}</span>}
        </section>
      )}

      {/* Upscale section — only meaningful once the main render is done */}
      {video.status === 'completed' && (
        <section className="bg-zinc-900 border border-zinc-800 rounded p-4 mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-semibold text-zinc-300">FHD (1920×1080, 4x-UltraSharp)</h2>
            <UpscaleStatusBadge status={video.upscaleStatus} />
          </div>

          {!video.upscaleStatus && (
            <div className="flex items-center gap-3">
              <button
                onClick={startUpscale}
                disabled={upscaleBusy}
                className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
              >
                {upscaleBusy ? '⏳ ставим в очередь…' : '🔼 апскейлить в FHD'}
              </button>
              <span className="text-zinc-500 text-xs">
                Прогонит mp4 через 4x-UltraSharp и сожмёт в 1920×1080 (~1–2 мин на 5-сек видео).
              </span>
              {upscaleError && <span className="text-red-400 text-xs">{upscaleError}</span>}
            </div>
          )}

          {video.upscaleStatus === 'running' && (
            <div className="text-blue-300 text-sm">⚙ Апскейл идёт в ComfyUI…</div>
          )}
          {video.upscaleStatus === 'pending' && (
            <div className="text-amber-300 text-sm">⏳ В очереди.</div>
          )}
          {video.upscaleStatus === 'failed' && (
            <div className="space-y-2">
              <div className="text-red-300 text-sm">
                ✕ Не удалось: {video.upscaleErrorMessage ?? 'неизвестная ошибка'}
              </div>
              <button
                onClick={startUpscale}
                disabled={upscaleBusy}
                className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-xs px-3 py-1 rounded"
              >
                ↻ повторить
              </button>
            </div>
          )}
          {video.upscaleStatus === 'completed' && video.upscaledFilename && (
            <div className="space-y-2">
              <video
                src={api.videoFhdFileUrl(video.id)}
                controls
                loop
                className="w-full bg-black rounded"
              />
              <a
                href={api.videoFhdFileUrl(video.id)}
                download
                className="inline-block text-blue-400 hover:text-blue-300 text-xs"
              >
                ⬇ скачать FHD ({video.upscaledFilename})
              </a>
            </div>
          )}
        </section>
      )}

      {video.status === 'pending' && (
        <div className="bg-amber-900/30 border border-amber-700/40 rounded p-4 text-amber-200 text-sm mb-4">
          ⏳ В очереди. ComfyUI запустит рендер как только освободится GPU.
        </div>
      )}
      {video.status === 'running' && (
        <div className="bg-blue-900/30 border border-blue-700/40 rounded p-4 text-blue-200 text-sm mb-4">
          ⚙ Рендерится в ComfyUI… (Wan2.2 i2v, ~5 сек видео занимает 30-90 сек на GPU)
        </div>
      )}
      {video.status === 'failed' && (
        <div className="bg-red-900/30 border border-red-700/40 rounded p-4 text-red-200 text-sm mb-4">
          ✕ Не удалось: {video.errorMessage ?? 'неизвестная ошибка'}
        </div>
      )}

      {/* Metadata */}
      <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Motion prompt</div>
          <div className="font-mono text-zinc-300 whitespace-pre-wrap">{video.motionPrompt || <em className="text-zinc-600">пустой</em>}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <Cell label="Source image" value={video.sourceImageFilename} mono />
          <Cell label="Workflow"     value={video.workflowFilename} mono />
          <Cell label="Seed"         value={String(params.seed ?? '—')} />
          <Cell label="Размер"        value={`${params.width ?? '?'}×${params.height ?? '?'}`} />
          <Cell label="Кадров"       value={String(params.length ?? '?')} />
          <Cell label="FPS"           value={String(params.fps ?? '?')} />
          <Cell label="Comfy prompt" value={video.comfyPromptId ?? '—'} mono />
          <Cell label="Output"       value={video.outputFilename ?? '—'} mono />
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-zinc-500">
          <Cell label="Queued"    value={new Date(video.queuedAt).toLocaleString()} />
          <Cell label="Started"   value={video.startedAt   ? new Date(video.startedAt).toLocaleString()   : '—'} />
          <Cell label="Completed" value={video.completedAt ? new Date(video.completedAt).toLocaleString() : '—'} />
        </div>
      </section>
    </main>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`text-zinc-300 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
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
  return <span className={`${m.cls} text-[11px] uppercase tracking-wider px-2 py-0.5 rounded`}>{m.label}</span>;
}

function UpscaleStatusBadge({ status }: { status: VideoRender['upscaleStatus'] }) {
  if (!status) return <span className="text-zinc-600 text-[10px] uppercase tracking-wider">не запускался</span>;
  const map: Record<NonNullable<VideoRender['upscaleStatus']>, { label: string; cls: string }> = {
    pending:   { label: '⏳ pending',   cls: 'text-amber-300 bg-amber-900/40' },
    running:   { label: '⚙ upscaling', cls: 'text-blue-300 bg-blue-900/40' },
    completed: { label: '✓ FHD ready', cls: 'text-emerald-300 bg-emerald-900/40' },
    failed:    { label: '✕ failed',    cls: 'text-red-300 bg-red-900/40' },
  };
  const m = map[status];
  return <span className={`${m.cls} text-[11px] uppercase tracking-wider px-2 py-0.5 rounded`}>{m.label}</span>;
}
