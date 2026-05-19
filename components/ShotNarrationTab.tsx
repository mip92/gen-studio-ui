'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, TTSJob, TTSVoice } from '../lib/api';
import { useShotCtx } from './ShotPageShell';

const VOICE_LABELS: Record<TTSVoice, string> = {
  eugene:  'Eugene (м, спокойный диктор)',
  aidar:   'Aidar (м, уверенный)',
  baya:    'Baya (ж, нейтральная)',
  kseniya: 'Kseniya (ж, мягкая)',
  xenia:   'Xenia (ж, выразительная)',
  ruslan:  'Ruslan (м, бас) — только V3/V4',
  random:  'Random — V3 only',
};

/**
 * Per-shot narration tab. Mirrors the bulk SceneShotsTTSModal but scoped to
 * one shot: text editor, render button, audio playback for the approved take,
 * history of past jobs.
 */
export function ShotNarrationTab() {
  const { shot, reload, shotId } = useShotCtx();

  const initialText = (shot as { narrationText?: string | null }).narrationText ?? '';
  const approvedId  = (shot as { approvedTTSJobId?: string | null }).approvedTTSJobId ?? null;

  const [text,    setText]    = useState(initialText);
  const [voice,   setVoice]   = useState<TTSVoice>('eugene');
  const [jobs,    setJobs]    = useState<TTSJob[] | null>(null);
  const [busy,    setBusy]    = useState<false | 'save' | 'render' | 'approve' | 'delete'>(false);
  const [err,     setErr]     = useState<string | null>(null);

  const refreshJobs = useCallback(() => {
    api.listShotTTSJobs(shotId).then(setJobs).catch(() => setJobs([]));
  }, [shotId]);

  useEffect(() => { refreshJobs(); }, [refreshJobs]);

  // Poll while any job is pending/running.
  useEffect(() => {
    if (!jobs) return;
    if (!jobs.some((j) => j.status === 'pending' || j.status === 'running')) return;
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, [jobs, refreshJobs]);

  // Reset textarea + voice when the underlying shot changes (route nav between shots).
  useEffect(() => {
    setText(initialText);
  }, [initialText, shotId]);

  const dirty = text !== initialText;

  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      await api.setShotNarrationText(shotId, text);
      await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally     { setBusy(false); }
  };

  const render = async () => {
    setBusy('render'); setErr(null);
    try {
      await api.setShotNarrationText(shotId, text);
      await api.startShotTTS(shotId, { voice });
      await reload();
      refreshJobs();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally     { setBusy(false); }
  };

  const approve = async (jobId: string) => {
    setBusy('approve'); setErr(null);
    try {
      await api.approveTTSJob(jobId);
      await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally     { setBusy(false); }
  };

  const clearApproval = async () => {
    setBusy('approve'); setErr(null);
    try {
      await api.clearShotTTSApproval(shotId);
      await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally     { setBusy(false); }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить этот wav? Если он был утверждён — статус сбросится.')) return;
    setBusy('delete'); setErr(null);
    try {
      await api.deleteTTSJob(jobId);
      await reload();
      refreshJobs();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally     { setBusy(false); }
  };

  const approvedJob = jobs?.find((j) => j.id === approvedId) ?? null;

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto space-y-4">
      {err && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 text-xs font-mono whitespace-pre-wrap break-all">
          {err}
        </div>
      )}

      {/* Text editor */}
      <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <label className="text-xs uppercase tracking-wider text-zinc-500">Текст озвучки (~5 сек на шот)</label>
          {dirty && <span className="text-amber-400 text-[10px]">не сохранено</span>}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что говорит диктор поверх этого кадра. Одна-две короткие фразы."
          rows={4}
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-3 text-sm text-zinc-200 font-sans resize-y"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs flex items-center gap-2">
            <span className="text-zinc-500 uppercase tracking-wider">Голос</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as TTSVoice)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
            >
              {(Object.keys(VOICE_LABELS) as TTSVoice[]).map((v) => (
                <option key={v} value={v}>{VOICE_LABELS[v]}</option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <button
              onClick={save}
              disabled={busy !== false || !dirty}
              className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-xs px-3 py-1.5 rounded"
            >
              {busy === 'save' ? '⏳ сохраняю…' : '💾 сохранить текст'}
            </button>
            <button
              onClick={render}
              disabled={busy !== false || text.trim().length === 0}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-sm font-medium px-4 py-1.5 rounded"
            >
              {busy === 'render' ? '⏳ ставлю в очередь…' : '🔊 озвучить (Silero V5 ru)'}
            </button>
          </div>
        </div>
      </section>

      {/* Approved take */}
      {approvedJob && (
        <section className="bg-emerald-950/30 border border-emerald-800 rounded p-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wider text-emerald-300">Утверждённая озвучка</h3>
            <button
              onClick={clearApproval}
              disabled={busy !== false}
              className="text-[10px] text-zinc-400 hover:text-red-300"
            >
              ✕ снять утверждение
            </button>
          </div>
          <audio controls preload="none" src={api.ttsFileUrl(approvedJob.id)} className="w-full max-w-md" />
          <div className="text-[10px] font-mono text-zinc-500">
            {approvedJob.voice} · {approvedJob.sampleRate} Hz · {approvedJob.outputFilename}
          </div>
        </section>
      )}

      {/* Job history */}
      <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">История</h3>
        {!jobs && <p className="text-zinc-500 text-sm">Загрузка…</p>}
        {jobs && jobs.length === 0 && (
          <p className="text-zinc-500 text-sm italic">— пока нет ни одной озвучки —</p>
        )}
        {jobs && jobs.map((j) => {
          const isApproved = j.id === approvedId;
          return (
            <div key={j.id} className={
              `flex items-center gap-3 p-2 rounded border ${isApproved ? 'border-emerald-800 bg-emerald-950/20' : 'border-zinc-800'}`
            }>
              <span className={
                j.status === 'completed' ? 'text-emerald-400'
                : j.status === 'running' ? 'text-amber-400'
                : j.status === 'pending' ? 'text-zinc-400'
                : j.status === 'failed' ? 'text-red-400'
                : 'text-zinc-600'
              }>
                {j.status === 'completed' ? '✓' : j.status === 'running' ? '⚙' : j.status === 'pending' ? '⏳' : j.status === 'failed' ? '✕' : '·'}
              </span>
              <span className="text-xs font-mono text-zinc-400">{j.voice} · {j.sampleRate}Hz</span>
              {j.status === 'completed' && (
                <audio controls preload="none" src={api.ttsFileUrl(j.id)} className="h-7 flex-1 max-w-md" />
              )}
              {j.status === 'failed' && (
                <span className="text-[10px] text-red-300/70 font-mono truncate flex-1">{j.errorMessage}</span>
              )}
              <span className="text-[10px] text-zinc-600 ml-auto">{new Date(j.queuedAt).toLocaleTimeString()}</span>
              {j.status === 'completed' && !isApproved && (
                <button
                  onClick={() => approve(j.id)}
                  disabled={busy !== false}
                  className="text-[11px] bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-0.5 rounded"
                >
                  утвердить
                </button>
              )}
              <button
                onClick={() => deleteJob(j.id)}
                disabled={busy !== false || j.status === 'running'}
                className="text-[11px] text-zinc-500 hover:text-red-400 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
