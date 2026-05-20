'use client';

/**
 * BGM page for a single project. Surfaces NarrativeBlocks with their segments
 * and ACE-Step render history. All actions go through lib/api.ts wrappers
 * which hit /bgm/* endpoints on the gen-studio backend. Audio is streamed
 * directly from /bgm/jobs/<id>/file (no pre-download).
 *
 * Refresh strategy: 5s poll while the user is on the page, same cadence as
 * ScenesList — matches backend's PipelineQueueService tick interval so the
 * UI lags at most one tick behind queue state changes.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, NarrativeBlock, MusicSegment, AudioRenderJob } from '../lib/api';

export function BgmList({ projectId }: { projectId: string }) {
  const [blocks, setBlocks] = useState<NarrativeBlock[] | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listBlocks(projectId)
      .then(setBlocks)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) {
    return (
      <main className="px-8 py-6 max-w-7xl mx-auto">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!blocks) return <main className="px-8 py-6 max-w-7xl mx-auto text-zinc-500">Loading…</main>;

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Фоновая музыка · ACE-Step</h2>
        <div className="text-xs text-zinc-500">
          {blocks.length} блоков
        </div>
      </div>

      {blocks.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          Блоков ещё нет.
        </div>
      )}

      <div className="space-y-6">
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} onChanged={refresh} />
        ))}
      </div>
    </main>
  );
}

// ─── Block card ─────────────────────────────────────────────────────────────

function BlockCard({ block, onChanged }: { block: NarrativeBlock; onChanged: () => void }) {
  const segments = block.segments ?? [];
  const covered  = segments.reduce((s, x) => s + x.durationSec, 0);
  const target   = block.targetSeconds ?? 0;
  const pct      = target > 0 ? Math.min(100, Math.round((covered / target) * 100)) : 0;

  const [prompt, setPrompt]     = useState(block.moodPrompt ?? '');
  const [dirty,  setDirty]      = useState(false);
  const [busy,   setBusy]       = useState(false);
  const [chunk,  setChunk]      = useState(60);

  // Resync editor when the block prop changes (e.g. server refresh changed moodPrompt)
  useEffect(() => {
    if (!dirty) setPrompt(block.moodPrompt ?? '');
  }, [block.moodPrompt, dirty]);

  const savePrompt = async () => {
    setBusy(true);
    try {
      await api.updateBlock(block.id, { moodPrompt: prompt });
      setDirty(false);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const fill = async () => {
    setBusy(true);
    try {
      await api.fillBlock(block.id, chunk);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const statusBadge = (() => {
    const base = 'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border';
    if (block.status === 'filled')  return <span className={`${base} text-emerald-300 border-emerald-700 bg-emerald-900/30`}>filled</span>;
    if (block.status === 'manual')  return <span className={`${base} text-zinc-300 border-zinc-700 bg-zinc-800/30`}>manual</span>;
    return <span className={`${base} text-amber-300 border-amber-700 bg-amber-900/30`}>filling</span>;
  })();

  return (
    <article className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          <span className="text-zinc-500 text-xs font-mono mr-2">#{block.sortOrder}</span>
          {block.title ?? block.slug}
          <span className="text-zinc-500 text-xs font-mono ml-2">({block.slug})</span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          {statusBadge}
          <span className="text-zinc-500 font-mono">
            {covered}s / {target}s · {pct}%
          </span>
          <span className="text-zinc-500">
            {segments.length} сегментов
          </span>
        </div>
      </header>

      <div className="px-5 py-4 space-y-4">
        {/* Mood prompt editor */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Mood-промпт (английский, ACE-Step теги)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setDirty(true); }}
            rows={3}
            className="w-full font-mono text-xs bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-200 focus:outline-none focus:border-zinc-600"
            placeholder="dark synthwave, industrial, 100 bpm, …"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[10px] text-zinc-500">
              {dirty ? 'не сохранено' : ' '}
            </div>
            <button
              onClick={savePrompt}
              disabled={!dirty || busy}
              className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 py-1 rounded"
            >
              сохранить
            </button>
          </div>
        </div>

        {/* Fill controls */}
        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Заполнить сегментами по</label>
          <input
            type="number"
            min={10}
            max={240}
            value={chunk}
            onChange={(e) => setChunk(Math.max(10, Math.min(240, Number(e.target.value) || 60)))}
            className="w-16 text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center"
          />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">сек</span>
          <button
            onClick={fill}
            disabled={busy || block.status === 'manual' || pct >= 100}
            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 py-1 rounded ml-2"
          >
            заполнить
          </button>
          {pct >= 100 && <span className="text-[10px] text-emerald-400">блок покрыт</span>}
        </div>

        {/* Segments */}
        {segments.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            {segments.map((seg) => (
              <SegmentRow
                key={seg.id}
                segment={seg}
                blockMoodPrompt={block.moodPrompt}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Segment row ────────────────────────────────────────────────────────────

function SegmentRow({
  segment,
  blockMoodPrompt,
  onChanged,
}: {
  segment:         MusicSegment;
  blockMoodPrompt: string | null;
  onChanged:       () => void;
}) {
  const jobs = segment.jobs ?? [];
  const approved   = jobs.find((j) => j.id === segment.approvedJobId);
  const inFlight   = jobs.find((j) => j.status === 'pending' || j.status === 'running');
  const completed  = jobs.filter((j) => j.status === 'completed');

  // Selected take (defaults to approved → newest completed → none).
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    approved?.id ?? completed[0]?.id ?? null,
  );
  useEffect(() => {
    // Keep selection in sync when the data refreshes — prefer approved.
    if (approved && selectedJobId !== approved.id) setSelectedJobId(approved.id);
    else if (!selectedJobId && completed[0]) setSelectedJobId(completed[0].id);
  }, [approved?.id, completed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null;

  const [override,    setOverride]   = useState(segment.prompt ?? '');
  const [dirty,       setDirty]      = useState(false);
  const [busy,        setBusy]       = useState(false);
  useEffect(() => { if (!dirty) setOverride(segment.prompt ?? ''); }, [segment.prompt, dirty]);

  const savePrompt = async () => {
    setBusy(true);
    try {
      // PATCH segment via createSegment? — no, we don't have an updateSegment endpoint.
      // Use delete+create as fallback OR add an endpoint. For now, surface a TODO.
      alert(
        'Per-segment prompt editing API is not implemented yet. Edit the block-level mood prompt or call POST /bgm/segments/<id>/render with an inline "prompt" override per take.',
      );
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const queueRender = async () => {
    setBusy(true);
    try {
      await api.startBgmRender(segment.id, { count: 1 });
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const approve = async (jobId: string) => {
    setBusy(true);
    try {
      await api.approveBgmJob(segment.id, jobId);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const unapprove = async () => {
    setBusy(true);
    try {
      await api.unapproveBgmJob(segment.id);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить эту версию (DB row + flac)?')) return;
    setBusy(true);
    try {
      await api.deleteBgmJob(jobId);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteSeg = async () => {
    if (!confirm('Удалить сегмент целиком (со всеми версиями)?')) return;
    setBusy(true);
    try {
      await api.deleteSegment(segment.id);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const effectivePrompt = (segment.prompt ?? blockMoodPrompt ?? '').trim();

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-mono">#{segment.sortOrder}</span>
          <span className="text-zinc-300">{segment.durationSec}s</span>
          {approved && <span className="text-emerald-400">✓ approved</span>}
          {inFlight && (
            <span className="text-amber-300">
              {inFlight.status === 'running' ? '⚙ running' : '⏳ pending'}
            </span>
          )}
          {!approved && !inFlight && completed.length > 0 && (
            <span className="text-zinc-500">{completed.length} take(s) — нужна аппрува</span>
          )}
          {!approved && !inFlight && completed.length === 0 && (
            <span className="text-zinc-500">ничего не рендерено</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={queueRender}
            disabled={busy}
            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-2 py-0.5 rounded"
            title="Поставить ACE-Step take в очередь"
          >
            ▶ render
          </button>
          <button
            onClick={deleteSeg}
            disabled={busy}
            className="text-xs text-zinc-400 hover:text-red-400 disabled:text-zinc-700 px-1"
            title="Удалить сегмент"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Override prompt (read-only for now until backend exposes PATCH) */}
      {segment.prompt !== null && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-zinc-500">override-промпт</summary>
          <textarea
            value={override}
            onChange={(e) => { setOverride(e.target.value); setDirty(true); }}
            rows={2}
            className="mt-1 w-full font-mono text-xs bg-zinc-900 border border-zinc-800 rounded p-2 text-zinc-300"
          />
          <div className="mt-1 flex justify-end">
            <button
              onClick={savePrompt}
              disabled={!dirty || busy}
              className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-2 py-0.5 rounded"
            >
              сохранить
            </button>
          </div>
        </details>
      )}

      {/* Player + take selector */}
      {completed.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className="text-zinc-500">Версия:</span>
            <select
              value={selectedJobId ?? ''}
              onChange={(e) => setSelectedJobId(e.target.value || null)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 font-mono"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.id.slice(0, 8)} · {j.status}
                  {j.id === segment.approvedJobId ? ' · ✓' : ''}
                  {j.params?.seed !== undefined ? ` · seed ${j.params.seed}` : ''}
                </option>
              ))}
            </select>
            {selected && selected.status === 'completed' && (
              <>
                {selected.id !== segment.approvedJobId ? (
                  <button
                    onClick={() => approve(selected.id)}
                    disabled={busy}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-0.5 rounded"
                  >
                    апрувнуть
                  </button>
                ) : (
                  <button
                    onClick={unapprove}
                    disabled={busy}
                    className="text-xs text-zinc-400 hover:text-amber-400"
                  >
                    снять апрув
                  </button>
                )}
                <button
                  onClick={() => deleteJob(selected.id)}
                  disabled={busy}
                  className="text-xs text-zinc-400 hover:text-red-400"
                >
                  удалить версию
                </button>
              </>
            )}
          </div>
          {selected && selected.status === 'completed' && (
            <audio
              key={selected.id}
              controls
              src={api.bgmJobFileUrl(selected.id)}
              className="w-full mt-1"
              preload="none"
              // ACE-Step renders are normalised loud. Default the preview to
              // ~20% so it matches the BGM-under-voiceover mix the CapCut
              // export uses (AudioSegment volume=0.2 there). User can still
              // bump up via the native controls slider if needed.
              ref={(el) => { if (el) el.volume = 0.2; }}
            />
          )}
        </div>
      )}

      {inFlight?.errorMessage && (
        <div className="mt-2 text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
          {inFlight.errorMessage}
        </div>
      )}
      {jobs.filter((j) => j.status === 'failed').slice(0, 1).map((j) => (
        <div key={j.id} className="mt-2 text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
          {j.errorMessage ?? 'failed (no message)'}
        </div>
      ))}

      {/* Effective prompt preview */}
      <details className="mt-2 text-[10px] text-zinc-600">
        <summary className="cursor-pointer">эффективный промпт</summary>
        <div className="mt-1 font-mono text-zinc-500 whitespace-pre-wrap">{effectivePrompt}</div>
      </details>
    </div>
  );
}
