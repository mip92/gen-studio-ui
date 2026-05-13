'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, VideoRender } from '../lib/api';

export function VideoDetail({
  projectId, shotId, videoId,
}: {
  projectId: string; shotId: string; videoId: string;
}) {
  const [video, setVideo] = useState<VideoRender | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getVideo(videoId).then(setVideo).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [videoId]);

  useEffect(() => { load(); }, [load]);

  // Live-refresh while the render is in flight.
  useEffect(() => {
    if (!video) return;
    if (video.status !== 'pending' && video.status !== 'running') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [video, load]);

  if (error) {
    return (
      <main className="px-8 py-6 max-w-5xl mx-auto">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!video) return <main className="px-8 py-6 max-w-5xl mx-auto text-zinc-500">Loading…</main>;

  const params = video.params ?? {};

  return (
    <main className="px-8 py-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-baseline gap-3">
        <Link href={`/projects/${projectId}/shots/${shotId}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← к кадру
        </Link>
        <h1 className="text-lg font-semibold text-zinc-200">Видео-рендер</h1>
        <StatusBadge status={video.status} />
      </div>

      {/* Video player when ready */}
      {video.status === 'completed' && video.outputFilename && (
        <video
          src={api.videoFileUrl(video.id)}
          controls
          loop
          className="w-full bg-black rounded mb-4"
        />
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
