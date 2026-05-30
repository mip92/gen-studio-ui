'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AnchorRenderJob, ProfileStyleReadiness } from '../lib/api';

/**
 * Anchor portrait panel for a character profile.
 *
 * Identity-stack for cartoon-style projects: IP-Adapter on a single anchor
 * portrait PNG. This panel exposes two ways to provide it:
 *
 *   1. Queue a render through gen-studio's pipeline (anchor_render_jobs +
 *      PipelineQueueService → auto-starts ComfyUI → runs the project's
 *      anchor workflow → copies result into reference/). UI polls job status.
 *   2. Upload an external PNG/JPG straight to disk (no GPU work).
 *
 * Auto-hides for characters attached only to photoreal-style projects.
 */

const STATUS_COLOR: Record<AnchorRenderJob['status'], string> = {
  pending:   'bg-zinc-700 text-zinc-200',
  running:   'bg-amber-700 text-amber-100',
  completed: 'bg-emerald-700 text-emerald-100',
  failed:    'bg-red-800   text-red-100',
  cancelled: 'bg-zinc-700  text-zinc-300',
};

const STATUS_LABEL: Record<AnchorRenderJob['status'], string> = {
  pending:   'в очереди',
  running:   'рендерится',
  completed: 'готов',
  failed:    'ошибка',
  cancelled: 'отменён',
};

const POLL_MS = 3000;

export function CharacterAnchorPanel({ profileId }: { profileId: string }) {
  const [readiness,   setReadiness]   = useState<ProfileStyleReadiness | null>(null);
  const [jobs,        setJobs]        = useState<AnchorRenderJob[] | null>(null);
  const [busy,        setBusy]        = useState<'enqueue' | 'upload' | 'delete' | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /** Cache-buster query param for the <img src>. Bumped on completion/upload so
   *  the browser refetches the new PNG instead of caching the old one. */
  const [anchorBust,  setAnchorBust]  = useState(Date.now());
  const prevCompleted = useRef<string | null>(null);
  const pollTimer     = useRef<NodeJS.Timeout | null>(null);

  // ESC closes the anchor lightbox — keyboard handler mirrors Lightbox in
  // CharacterDetail.tsx for consistency with the dataset viewer.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  const loadAll = useCallback(async () => {
    try {
      const [r, j] = await Promise.all([
        api.profileStyleReadiness(profileId),
        api.listAnchorJobs(profileId),
      ]);
      setReadiness(r);
      setJobs(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  // Initial load + start polling
  useEffect(() => {
    void loadAll();
    pollTimer.current = setInterval(() => { void loadAll(); }, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [loadAll]);

  // When the most recent completed job id changes (i.e. a new render finished),
  // bump the cache-buster so the <img> refetches the new PNG.
  useEffect(() => {
    const lastCompleted = jobs?.find((j) => j.status === 'completed');
    if (lastCompleted && lastCompleted.id !== prevCompleted.current) {
      prevCompleted.current = lastCompleted.id;
      setAnchorBust(Date.now());
    }
  }, [jobs]);

  const hasCartoonProject = (readiness?.attachedProjects ?? []).some(
    (p) => p.visualStyle !== 'photoreal_cinematic',
  );
  const isLibrary = (readiness?.attachedProjects ?? []).length === 0;
  if (readiness && !hasCartoonProject && !isLibrary) return null;

  const cartoonStyles = readiness
    ? Object.entries(readiness.styles).filter(([, s]) => s.identityStack !== 'lora_face_lock')
    : [];
  const primaryAnchor = cartoonStyles
    .map(([, s]) => s.assets.anchorPath)
    .find((p): p is string => p !== null) ?? null;

  const activeJob = jobs?.find((j) => j.status === 'pending' || j.status === 'running') ?? null;
  const lastJob   = jobs?.[0] ?? null;

  const handleEnqueue = async () => {
    setBusy('enqueue');
    setError(null);
    try {
      await api.generateAnchor(profileId);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (file: File) => {
    setBusy('upload');
    setError(null);
    try {
      await api.uploadAnchor(profileId, file);
      setAnchorBust(Date.now());
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить anchor portrait? После удаления можно сгенерировать заново.')) return;
    setBusy('delete');
    setError(null);
    try {
      await api.deleteAnchor(profileId);
      setAnchorBust(Date.now());
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">
          Anchor portrait (cartoon identity)
        </h2>
        {readiness && cartoonStyles.length > 0 && (
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${
              primaryAnchor
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            {primaryAnchor ? 'anchor ready' : 'no anchor yet'}
          </span>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Для cartoon-стилей identity лочится через IP-Adapter на одном portrait-anchor — никакой character-LoRA не нужно.
        Можно сгенерить через очередь (ComfyUI поднимется автоматически если выключен) или загрузить готовый PNG/JPG.
      </p>

      <div className="flex gap-4">
        {/* Preview — streams via /profiles/:id/anchor/raw. Cache-bust on every
            successful render/upload so the new image surfaces immediately.
            Clicking opens a lightbox (same UX as dataset thumbnails). */}
        <button
          type="button"
          onClick={() => primaryAnchor && setLightboxOpen(true)}
          disabled={!primaryAnchor}
          className="w-40 h-56 bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex-shrink-0 flex items-center justify-center hover:border-purple-600 disabled:hover:border-zinc-800 disabled:cursor-default cursor-zoom-in"
          title={primaryAnchor ? 'Open full-size' : 'No anchor yet'}
        >
          {primaryAnchor ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={api.anchorRawUrl(profileId, anchorBust)}
              alt="anchor portrait"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-zinc-600 text-sm">no preview</div>
          )}
        </button>

        {/* Actions */}
        <div className="flex flex-col gap-2 flex-1">
          <button
            type="button"
            onClick={handleEnqueue}
            disabled={busy !== null || !!activeJob}
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded text-sm"
            title={activeJob ? 'Job is already in the queue' : ''}
          >
            {activeJob
              ? `In queue (${activeJob.status})`
              : busy === 'enqueue'
                ? 'Enqueuing…'
                : primaryAnchor
                  ? 'Regenerate via prompt (queue)'
                  : 'Generate via prompt (queue)'}
          </button>

          <label className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-100 px-4 py-2 rounded text-sm text-center cursor-pointer block">
            {busy === 'upload' ? 'Uploading…' : primaryAnchor ? 'Replace from file (PNG/JPG)' : 'Upload from file (PNG/JPG)'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
          </label>

          {/* Delete button only when an anchor actually exists. After delete
              the Generate / Upload buttons return to "from scratch" labels. */}
          {primaryAnchor && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== null || !!activeJob}
              className="text-zinc-400 hover:text-red-400 disabled:opacity-50 border border-zinc-800 rounded px-4 py-2 text-sm"
              title="Delete current anchor (you can regenerate after)"
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete anchor'}
            </button>
          )}

          {error && (
            <div className="bg-red-900/40 border border-red-800 rounded p-2 text-red-200 text-xs font-mono break-all">
              {error}
            </div>
          )}

          {lastJob && (
            <div className="text-xs text-zinc-500 mt-1">
              <span
                className={`inline-block px-2 py-0.5 rounded mr-2 ${STATUS_COLOR[lastJob.status]}`}
              >
                {STATUS_LABEL[lastJob.status]}
              </span>
              <span className="text-zinc-500">job {lastJob.id.slice(0, 8)}</span>
              {lastJob.errorMessage && (
                <div className="text-red-300 mt-1 font-mono break-all">{lastJob.errorMessage}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Anchor lightbox — full-size view, mirrors the dataset Lightbox styling
          from CharacterDetail.tsx but simpler since there's only one image. */}
      {lightboxOpen && primaryAnchor && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
            <div className="text-zinc-400 text-xs font-mono break-all">
              {primaryAnchor.split(/[\\/]/).pop()}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete().then(() => setLightboxOpen(false));
                }}
                className="text-xs bg-red-700/80 hover:bg-red-600 text-white px-3 py-1 rounded"
              >
                ✕ удалить
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
                className="text-xs bg-zinc-800/80 hover:bg-zinc-700 text-white px-3 py-1 rounded"
              >
                ESC
              </button>
            </div>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={api.anchorRawUrl(profileId, anchorBust)}
            alt="anchor portrait"
            className="max-w-[95vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Style readiness table */}
      {readiness && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            Per-style readiness ({Object.keys(readiness.styles).length} styles)
          </summary>
          <table className="mt-2 w-full font-mono text-[11px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left py-1">Style</th>
                <th className="text-left py-1">Identity</th>
                <th className="text-left py-1">Ready?</th>
                <th className="text-left py-1">Asset</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(readiness.styles).map(([id, s]) => (
                <tr key={id} className="border-t border-zinc-800">
                  <td className="py-1">{id}</td>
                  <td className="py-1 text-zinc-400">{s.identityStack}</td>
                  <td className="py-1">
                    {s.ready ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="py-1 text-zinc-400 truncate max-w-[280px]" title={s.assets.loraPath ?? s.assets.anchorPath ?? ''}>
                    {s.assets.loraPath ?? s.assets.anchorPath ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
