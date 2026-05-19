'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, SceneShot, TTSJob, TTSVoice } from '../lib/api';

interface Props {
  sceneId:     string;
  sceneTitle:  string;
  shots:       SceneShot[];
  onClose:     () => void;
}

const VOICE_LABELS: Record<TTSVoice, string> = {
  eugene:  'Eugene (м, спокойный диктор)',
  aidar:   'Aidar (м, уверенный)',
  baya:    'Baya (ж, нейтральная)',
  kseniya: 'Kseniya (ж, мягкая)',
  xenia:   'Xenia (ж, выразительная)',
  ruslan:  'Ruslan (м, бас) — только V3/V4',
  random:  'Random (новый голос каждый раз) — V3 only',
};

/**
 * Bulk narration manager for a scene's shots. Each shot has its own
 * ~5s `narrationText` and approved TTSJob; this modal lists them and lets
 * the user (a) edit per-shot text inline, (b) queue TTS for one shot,
 * (c) bulk-queue TTS for every shot in the scene.
 *
 * Replaces the old SceneNarrationModal flow where the whole scene shared
 * a single long voiceover.
 */
export function SceneShotsTTSModal({ sceneId, sceneTitle, shots, onClose }: Props) {
  const [voice, setVoice] = useState<TTSVoice>('eugene');
  // Per-shot in-memory state: edit buffers + last-queued job summary.
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(shots.map((s) => [s.id, s.narrationText ?? ''])),
  );
  const [jobsByShot, setJobsByShot] = useState<Record<string, TTSJob[]>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [busyAll, setBusyAll] = useState<false | 'all' | 'missing'>(false);
  const [err,     setErr]     = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    const entries = await Promise.all(
      shots.map(async (s) => [s.id, await api.listShotTTSJobs(s.id).catch(() => [])] as const),
    );
    setJobsByShot(Object.fromEntries(entries));
  }, [shots]);

  useEffect(() => { refreshJobs(); }, [refreshJobs]);

  // Poll while anything is pending/running.
  useEffect(() => {
    const anyInflight = Object.values(jobsByShot).some(
      (jobs) => jobs.some((j) => j.status === 'pending' || j.status === 'running'),
    );
    if (!anyInflight) return;
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, [jobsByShot, refreshJobs]);

  const saveText = async (shotId: string) => {
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try {
      await api.setShotNarrationText(shotId, drafts[shotId] ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [shotId]: false }));
    }
  };

  const renderOne = async (shotId: string) => {
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try {
      // Save first so what gets synthesised matches what's in the textarea.
      await api.setShotNarrationText(shotId, drafts[shotId] ?? '');
      await api.startShotTTS(shotId, { voice });
      refreshJobs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [shotId]: false }));
    }
  };

  const renderAll = async (mode: 'all' | 'missing') => {
    setBusyAll(mode);
    setErr(null);
    let queued = 0;
    for (const s of shots) {
      // Skip shots whose narrationText is empty — TTS can't run on empty text.
      const text = (drafts[s.id] ?? '').trim();
      if (!text) continue;
      // "missing" mode: skip shots that already have an approved completed job.
      if (mode === 'missing') {
        const hasApproved = (jobsByShot[s.id] ?? []).some(
          (j) => j.id === s.approvedTTSJobId && j.status === 'completed',
        );
        if (hasApproved) continue;
      }
      try {
        await api.setShotNarrationText(s.id, text);
        await api.startShotTTS(s.id, { voice });
        queued++;
      } catch (e) {
        setErr(`Shot ${s.shotCode}: ${e instanceof Error ? e.message : String(e)}`);
        // Don't bail — keep queueing the rest.
      }
    }
    await refreshJobs();
    setBusyAll(false);
    if (queued === 0) setErr('Нечего озвучивать — у всех шотов либо пустой текст, либо уже есть утверждённая озвучка.');
  };

  const totalWithText     = shots.filter((s) => (drafts[s.id] ?? '').trim().length > 0).length;
  const totalApproved     = shots.filter(
    (s) => s.approvedTTSJobId && (jobsByShot[s.id] ?? []).some((j) => j.id === s.approvedTTSJobId && j.status === 'completed'),
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-zinc-800 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">
            🔊 Озвучка сцены — <span className="font-mono">{sceneTitle}</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </header>

        {/* Top bar: voice picker + bulk actions */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-end gap-4 flex-wrap">
          <label className="text-xs flex flex-col gap-1">
            <span className="text-zinc-500 uppercase tracking-wider">Голос (применится ко всем)</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as TTSVoice)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 min-w-[260px]"
            >
              {(Object.keys(VOICE_LABELS) as TTSVoice[]).map((v) => (
                <option key={v} value={v}>{VOICE_LABELS[v]}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => renderAll('missing')}
              disabled={busyAll !== false}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
              title="Озвучить только шоты у которых ещё нет утверждённого wav"
            >
              {busyAll === 'missing' ? '⏳ ставим…' : '🎙 Озвучить недостающие'}
            </button>
            <button
              onClick={() => renderAll('all')}
              disabled={busyAll !== false}
              className="bg-amber-700 hover:bg-amber-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
              title="Озвучить все шоты сцены (перезапишет существующие jobs)"
            >
              {busyAll === 'all' ? '⏳ ставим…' : '🔁 Озвучить все'}
            </button>
          </div>
        </div>

        <div className="px-5 py-2 text-xs text-zinc-500 border-b border-zinc-800 flex gap-4">
          <span>{shots.length} шотов</span>
          <span>📝 с текстом: {totalWithText}</span>
          <span>✓ утверждено: {totalApproved}</span>
          {err && <span className="ml-auto text-red-400 font-mono break-all">{err}</span>}
        </div>

        {/* Per-shot rows */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {shots.map((s) => {
            const jobs        = jobsByShot[s.id] ?? [];
            const latest      = jobs[0];
            const approvedJob = jobs.find((j) => j.id === s.approvedTTSJobId);
            const draft       = drafts[s.id] ?? '';
            const dirty       = draft !== (s.narrationText ?? '');
            const isBusy      = saving[s.id] === true;

            return (
              <div key={s.id} className="bg-zinc-950 border border-zinc-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-zinc-300">{s.shotCode}</span>
                  <div className="flex items-center gap-2 text-[10px]">
                    {approvedJob && (
                      <span className="text-emerald-400">✓ утверждён</span>
                    )}
                    {latest && (
                      <span className={
                        latest.status === 'completed' ? 'text-emerald-500'
                        : latest.status === 'running' ? 'text-amber-400'
                        : latest.status === 'pending' ? 'text-zinc-400'
                        : latest.status === 'failed' ? 'text-red-400'
                        : 'text-zinc-600'
                      }>
                        {latest.status === 'completed' ? '🔊' : latest.status === 'running' ? '⚙' : latest.status === 'pending' ? '⏳' : latest.status === 'failed' ? '✕' : ''}
                        {' '}{latest.status}
                      </span>
                    )}
                    {approvedJob && (
                      <audio controls preload="none" src={api.ttsFileUrl(approvedJob.id)} className="h-6" />
                    )}
                  </div>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  placeholder="Текст озвучки этого шота (~5 сек)…"
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm text-zinc-200 font-sans resize-y"
                />
                <div className="flex justify-end gap-2 mt-1.5">
                  {dirty && (
                    <button
                      onClick={() => saveText(s.id)}
                      disabled={isBusy}
                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-[11px] px-2 py-0.5 rounded"
                    >
                      💾 сохранить
                    </button>
                  )}
                  <button
                    onClick={() => renderOne(s.id)}
                    disabled={isBusy || draft.trim().length === 0}
                    className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-[11px] px-2 py-0.5 rounded"
                  >
                    {isBusy ? '⏳' : '🎙 озвучить'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
