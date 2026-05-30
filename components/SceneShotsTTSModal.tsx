'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, SceneShot, TTSJob, TTSVoice, ProjectFull, ProjectTTSEmotionRef } from '../lib/api';

interface Props {
  projectId:   string;
  sceneId:     string;
  sceneTitle:  string;
  shots:       SceneShot[];
  onClose:     () => void;
}

const SILERO_VOICE_LABELS: Record<TTSVoice, string> = {
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
 * `narrationText` and approved TTSJob; this modal lists them and lets the user
 * (a) edit per-shot text inline, (b) queue TTS for one shot, (c) bulk-queue TTS
 * for every shot in the scene.
 *
 * Engine-aware — shows only the controls the engine honours: Silero voice
 * dropdown; voice-clone (xtts2/f5) emotion-reference picker; plus speed +
 * sentence-pause for f5 (the only engine whose worker accepts them).
 */
export function SceneShotsTTSModal({ projectId, sceneId, sceneTitle, shots, onClose }: Props) {
  const [project,     setProject]     = useState<ProjectFull | null>(null);
  const [emotionRefs, setEmotionRefs] = useState<ProjectTTSEmotionRef[]>([]);
  const [voice,         setVoice]         = useState<TTSVoice>('baya');  // ж дефолт для silero — narrator is female
  const [emotionRefName, setEmotionRefName] = useState<string>('');      // '' = neutral (just the voice ref)
  const [speed,          setSpeed]          = useState<number>(1.0);     // f5 only → TTSJob.rate
  const [pause,          setPause]          = useState<number>(0);       // f5 only → sentencePauseSec
  // Per-shot in-memory state: edit buffers + last-queued job summary.
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(shots.map((s) => [s.id, s.narrationText ?? ''])),
  );
  const [jobsByShot, setJobsByShot] = useState<Record<string, TTSJob[]>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [busyAll, setBusyAll] = useState<false | 'all' | 'missing'>(false);
  const [err,     setErr]     = useState<string | null>(null);

  // Load project (for engine) + emotion refs once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getProject(projectId);
        if (cancelled) return;
        setProject(p);
        if ((p.ttsEngine ?? 'silero') !== 'silero') {
          const refs = await api.listProjectEmotionRefs(projectId);
          if (!cancelled) setEmotionRefs(refs);
        }
      } catch (e) {
        if (!cancelled) setErr(asMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

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

  const engine = (project?.ttsEngine ?? 'silero') as 'silero' | 'xtts2' | 'f5';

  /** Build the TTS request body matching the project's engine — voice for
   *  silero; emotion-reference (+ speed/pause for f5) for the voice-clone
   *  engines. Categorical presets are inert on xtts2/f5 so we never send them. */
  const synthBody = (): Parameters<typeof api.startShotTTS>[1] => {
    if (engine === 'silero') return { voice };
    const body: Parameters<typeof api.startShotTTS>[1] = {};
    if (emotionRefName) body.emotionRefName = emotionRefName;
    if (engine === 'f5') {
      body.rate             = speed;
      body.sentencePauseSec = pause;
    }
    return body;
  };

  const saveText = async (shotId: string) => {
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try {
      await api.setShotNarrationText(shotId, drafts[shotId] ?? '');
    } catch (e) {
      setErr(asMessage(e));
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
      await api.startShotTTS(shotId, synthBody());
      refreshJobs();
    } catch (e) {
      setErr(asMessage(e));
    } finally {
      setSaving((s) => ({ ...s, [shotId]: false }));
    }
  };

  const approveJob = async (shotId: string, jobId: string) => {
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try {
      await api.approveTTSJob(jobId);
      refreshJobs();
    } catch (e) {
      setErr(asMessage(e));
    } finally {
      setSaving((s) => ({ ...s, [shotId]: false }));
    }
  };

  /** Delete the most recent playable wav for this shot (approved if exists,
   *  else latest completed). Used as a quick "rewind" — the next ▶ Синтез
   *  click for this shot will start from scratch. */
  const deletePlayable = async (shotId: string, jobId: string) => {
    if (!confirm('Удалить этот wav? Если он был утверждён — статус сбросится.')) return;
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try {
      await api.deleteTTSJob(jobId);
      refreshJobs();
    } catch (e) {
      setErr(asMessage(e));
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
        await api.startShotTTS(s.id, synthBody());
        queued++;
      } catch (e) {
        setErr(`Shot ${s.shotCode}: ${asMessage(e)}`);
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

  const voiceRefMissing = engine !== 'silero' && !project?.ttsVoiceRefPath;

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
            <span className="ml-3 text-[10px] text-zinc-500 font-normal">
              [engine: <span className={engine !== 'silero' ? 'text-emerald-300' : 'text-zinc-300'}>
                {engine === 'silero' ? 'Silero V5 ru' : engine === 'xtts2' ? 'XTTS-v2 (voice clone)' : 'F5-TTS Russian (voice clone)'}
              </span>]
            </span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </header>

        {voiceRefMissing && (
          <div className="px-5 py-2 bg-amber-950/40 border-b border-amber-800/50 text-amber-200 text-[11px]">
            ⚠ Voice-reference не загружен в настройках проекта — voice-clone синтез упадёт. Загрузи через
            <code className="mx-1 text-amber-300">/projects/{projectId}/settings</code> → секция 🎙 TTS Engine.
          </div>
        )}

        {/* Top bar: engine-specific controls + bulk actions */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-end gap-4 flex-wrap">
          {engine === 'silero' && (
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Голос (применится ко всем)</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as TTSVoice)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 min-w-[260px]"
              >
                {(Object.keys(SILERO_VOICE_LABELS) as TTSVoice[]).map((v) => (
                  <option key={v} value={v}>{SILERO_VOICE_LABELS[v]}</option>
                ))}
              </select>
            </label>
          )}
          {engine !== 'silero' && (
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Эмоция (применится ко всем)</span>
              {emotionRefs.length > 0 ? (
                <select
                  value={emotionRefName}
                  onChange={(e) => setEmotionRefName(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 min-w-[200px]"
                >
                  <option value="">— нейтрально (голос-референс) —</option>
                  {emotionRefs.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-zinc-500 py-1.5">
                  нет референсов —{' '}
                  <a href={`/projects/${projectId}/settings`} className="text-emerald-400 hover:underline">
                    загрузить в настройках
                  </a>
                </span>
              )}
            </label>
          )}
          {engine === 'f5' && (
            <>
              <label className="text-xs flex flex-col gap-1">
                <span className="text-zinc-500 uppercase tracking-wider">Скорость ({speed.toFixed(2)}×)</span>
                <input
                  type="range"
                  min={0.5} max={2.0} step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-40"
                />
              </label>
              <label className="text-xs flex flex-col gap-1">
                <span className="text-zinc-500 uppercase tracking-wider">Пауза, сек/предлож.</span>
                <input
                  type="number"
                  min={0} max={30} step={0.5}
                  value={pause}
                  onChange={(e) => setPause(Math.max(0, Math.min(30, parseFloat(e.target.value) || 0)))}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono w-24"
                />
              </label>
            </>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => renderAll('missing')}
              disabled={busyAll !== false || voiceRefMissing}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
              title="Синтез только для шотов без утверждённой озвучки"
            >
              {busyAll === 'missing' ? '⏳' : '▶ Синтез новых'}
            </button>
            <button
              onClick={() => renderAll('all')}
              disabled={busyAll !== false || voiceRefMissing}
              className="bg-amber-700 hover:bg-amber-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
              title="Пересинтез всех шотов сцены (заменит существующие)"
            >
              {busyAll === 'all' ? '⏳' : '↻ Пересинтез всех'}
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
            const jobs           = jobsByShot[s.id] ?? [];
            const latest         = jobs[0];
            // Most recent completed take — always show this audio player so
            // the user can listen before approving (and not only after).
            const latestCompleted = jobs.find((j) => j.status === 'completed') ?? null;
            const approvedJob    = jobs.find((j) => j.id === s.approvedTTSJobId);
            const playableJob    = approvedJob ?? latestCompleted;
            const draft          = drafts[s.id] ?? '';
            const dirty          = draft !== (s.narrationText ?? '');
            const isBusy         = saving[s.id] === true;
            const inFlight       = latest && (latest.status === 'pending' || latest.status === 'running');

            return (
              <div key={s.id} className={
                `bg-zinc-950 border rounded p-3 ${approvedJob ? 'border-emerald-800/60' : latestCompleted ? 'border-amber-800/40' : 'border-zinc-800'}`
              }>
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <span className="font-mono text-xs text-zinc-300">{s.shotCode}</span>
                  <div className="flex items-center gap-2 text-[10px] flex-1 justify-end flex-wrap">
                    {approvedJob && (
                      <span className="text-emerald-400 font-mono">✓ утверждён</span>
                    )}
                    {!approvedJob && latestCompleted && (
                      <span className="text-amber-300 font-mono">🔊 готов, не утверждён</span>
                    )}
                    {inFlight && (
                      <span className="text-blue-300 font-mono">
                        {latest!.status === 'running' ? '⚙ рендерится' : '⏳ в очереди'}
                      </span>
                    )}
                    {latest && latest.status === 'failed' && (
                      <span className="text-red-400 font-mono" title={latest.errorMessage ?? ''}>✕ упал</span>
                    )}
                    {playableJob && (
                      <audio
                        controls
                        preload="none"
                        src={api.ttsFileUrl(playableJob.id)}
                        className="h-7 max-w-[260px]"
                      />
                    )}
                    {latestCompleted && !approvedJob && (
                      <button
                        onClick={() => approveJob(s.id, latestCompleted.id)}
                        disabled={isBusy}
                        title="Утвердить этот wav как канонический для шота"
                        className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-[10px] px-2 py-0.5 rounded"
                      >
                        {isBusy ? '⏳' : '✓ утвердить'}
                      </button>
                    )}
                    {playableJob && (
                      <button
                        onClick={() => deletePlayable(s.id, playableJob.id)}
                        disabled={isBusy}
                        title={approvedJob ? 'Удалить утверждённый wav (approval тоже сбросится)' : 'Удалить этот wav'}
                        className="bg-red-900/40 hover:bg-red-800/60 border border-red-900/60 hover:border-red-700 disabled:opacity-30 text-red-300 hover:text-red-200 text-[10px] px-2 py-0.5 rounded"
                      >
                        {isBusy ? '⏳' : '✕ удалить'}
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  placeholder="Текст озвучки этого шота…"
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
                    disabled={isBusy || draft.trim().length === 0 || voiceRefMissing}
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

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
