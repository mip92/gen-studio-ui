'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, VideoRender } from '../lib/api';

export function VideosList({ projectId, shotId }: { projectId: string; shotId: string }) {
  const [videos, setVideos] = useState<VideoRender[] | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  const load = useCallback(() => {
    api.listVideosForShot(shotId)
      .then(setVideos)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [shotId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!videos) return;
    const hasInFlight = videos.some((v) => v.status === 'pending' || v.status === 'running');
    if (!hasInFlight) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [videos, load]);

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="mb-4 flex items-baseline gap-3">
        <Link href={`/projects/${projectId}/shots/${shotId}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← к кадру
        </Link>
        <h1 className="text-lg font-semibold text-zinc-200">Видео по шоту</h1>
        {videos && (
          <span className="text-xs text-zinc-500">всего {videos.length}</span>
        )}
      </div>

      {videos === null && <p className="text-zinc-500 text-sm">Loading…</p>}
      {videos && videos.length === 0 && (
        <p className="text-zinc-600 text-sm italic">Пока ничего не нагенерировано. Вернитесь на страницу шота и запустите рендер.</p>
      )}

      {videos && videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} projectId={projectId} shotId={shotId} />
          ))}
        </div>
      )}
    </main>
  );
}

function VideoCard({ video, projectId, shotId }: {
  video: VideoRender;
  projectId: string;
  shotId: string;
}) {
  const params = video.params ?? {};
  const isReady = video.status === 'completed' && video.outputFilename;

  return (
    <Link
      href={`/projects/${projectId}/shots/${shotId}/videos/${video.id}`}
      className="block bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded overflow-hidden"
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
      </div>

      <div className="p-3 text-xs space-y-1">
        <div className="text-zinc-400 font-mono">
          {new Date(video.queuedAt).toLocaleString()}
        </div>
        <div className="text-zinc-500">
          {(params.width ?? '?')}×{(params.height ?? '?')} · {params.length ?? '?'}f @ {params.fps ?? '?'}fps · seed {params.seed ?? '—'}
        </div>
        <div className="text-zinc-300 truncate" title={video.motionPrompt}>
          {video.motionPrompt || <em className="text-zinc-600">no prompt</em>}
        </div>
        {video.status === 'failed' && video.errorMessage && (
          <div className="text-red-400 truncate" title={video.errorMessage}>
            {video.errorMessage}
          </div>
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
