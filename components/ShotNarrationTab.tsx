'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, TTSJob, TTSVoice, ProjectFull, ProjectTTSEmotionRef, VoVerdictView, TTSEngine, TTS_ENGINE_LABELS } from '../lib/api';
import { useShotCtx } from './ShotPageShell';
import { useLiveEvents, on } from '../lib/liveEvents';

const SILERO_VOICE_LABELS: Record<TTSVoice, string> = {
  eugene:  'Eugene (м, спокойный диктор)',
  aidar:   'Aidar (м, уверенный)',
  baya:    'Baya (ж, нейтральная)',
  kseniya: 'Kseniya (ж, мягкая)',
  xenia:   'Xenia (ж, выразительная)',
  ruslan:  'Ruslan (м, бас) — только V3/V4',
  random:  'Random — V3 only',
};

/**
 * Per-shot narration tab — engine-aware. Reads project.ttsEngine and renders
 * ONLY the controls the engine actually honours:
 *   - silero      → voice dropdown
 *   - xtts2 | f5  → emotion-reference picker (categorical presets are inert on
 *                   these voice-clone engines — tone comes from the ref clip)
 *   - f5          → additionally speed + sentence-pause (the only engine whose
 *                   worker accepts --speed / --sentence-pause-sec)
 * One ▶ Синтез button drives the job; backend snapshots the engine + knobs.
 */
export function ShotNarrationTab() {
  const { shot, reload, shotId, projectId } = useShotCtx();

  const initialText = (shot as { narrationText?: string | null }).narrationText ?? '';
  const approvedId  = (shot as { approvedTTSJobId?: string | null }).approvedTTSJobId ?? null;

  const [project,        setProject]        = useState<ProjectFull | null>(null);
  /**
   * The project's voice and its leading-bleed profile ('pon' | 'sha' | null).
   * Null profile = this voice does not bleed, so the trim button is not offered:
   * on a clean voice the detector mistakes a quiet leading preposition for the
   * artifact and eats the word (the backend refuses too).
   */
  const [bleedProfile,   setBleedProfile]   = useState<string | null>(null);
  const [emotionRefs,    setEmotionRefs]    = useState<ProjectTTSEmotionRef[]>([]);
  const [text,           setText]           = useState(initialText);
  const [voice,          setVoice]          = useState<TTSVoice>('baya');  // ж голос дефолтом — narrator is female
  const [emotionRefName, setEmotionRefName] = useState<string>('');        // '' = neutral (just the voice ref)
  const [speed,          setSpeed]          = useState<number>(0.85);      // f5 only → TTSJob.rate (default 0.85 — slowed, user request 2026-06-18)
  const [pause,          setPause]          = useState<number>(1);         // f5 only → sentencePauseSec (f5 default — 1s between sentences)
  const [front,          setFront]          = useState<boolean>(false);    // checked = jump to front of TTS queue (default off)
  const [jobs,           setJobs]           = useState<TTSJob[] | null>(null);
  const [historyOpen,    setHistoryOpen]    = useState<boolean>(true);  // история открыта по умолчанию
  const [busy,           setBusy]           = useState<false | 'save' | 'render' | 'approve' | 'delete' | 'trim'>(false);
  const [err,            setErr]            = useState<string | null>(null);
  const [notice,         setNotice]         = useState<string | null>(null);

  // Load project (for engine) + emotion refs once per projectId.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getProject(projectId);
        if (cancelled) return;
        setProject(p);
        if (p.ttsVoiceoverId) {
          api.getVoiceover(p.ttsVoiceoverId)
            .then((v) => { if (!cancelled) setBleedProfile(v.artifactProfile); })
            .catch(() => { /* no profile known → button stays hidden */ });
        }
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

  const refreshJobs = useCallback(() => {
    api.listShotTTSJobs(shotId).then(setJobs).catch(() => setJobs([]));
  }, [shotId]);

  useEffect(() => { refreshJobs(); }, [refreshJobs]);

  const ttsInFlight = (jobs ?? []).some((j) => j.status === 'pending' || j.status === 'running');
  const ttsMatch = useCallback(on.all(on.shot(shotId), on.types('tts')), [shotId]);
  useLiveEvents(ttsMatch, refreshJobs, { active: ttsInFlight });

  // Reset textarea when route nav between shots.
  useEffect(() => { setText(initialText); }, [initialText, shotId]);

  const engine    = (project?.ttsEngine ?? 'silero') as TTSEngine;
  const dirty     = text !== initialText;
  const canSynth  = text.trim().length > 0 && busy === false &&
                    (engine === 'silero' || !!project?.ttsVoiceRefPath);

  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      await api.setShotNarrationText(shotId, text);
      await reload();
    } catch (e) { setErr(asMessage(e)); }
    finally     { setBusy(false); }
  };

  const synth = async () => {
    setBusy('render'); setErr(null);
    try {
      await api.setShotNarrationText(shotId, text);
      const body: Parameters<typeof api.startShotTTS>[1] = {};
      if (engine === 'silero') {
        body.voice = voice;
      } else {
        // Voice-clone (xtts2 | f5): tone comes only from the emotion-reference
        // clip — categorical presets are inert, so we never send them. Empty
        // selection = neutral (just the project voice reference).
        if (emotionRefName) body.emotionRefName = emotionRefName;
        // Speed is f5-only (qwen3 has no speed knob); the sentence pause is
        // honoured by both f5 and qwen3 workers.
        if (engine === 'f5') {
          body.rate = speed;
        }
        if (engine === 'f5' || engine === 'qwen3') {
          body.sentencePauseSec = pause;
        }
      }
      if (front) body.front = true;
      await api.startShotTTS(shotId, body);
      await reload();
      refreshJobs();
    } catch (e) { setErr(asMessage(e)); }
    finally     { setBusy(false); }
  };

  const approve = async (jobId: string) => {
    setBusy('approve'); setErr(null);
    try { await api.approveTTSJob(jobId); await reload(); }
    catch (e) { setErr(asMessage(e)); }
    finally   { setBusy(false); }
  };

  const clearApproval = async () => {
    setBusy('approve'); setErr(null);
    try { await api.clearShotTTSApproval(shotId); await reload(); }
    catch (e) { setErr(asMessage(e)); }
    finally   { setBusy(false); }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить этот wav? Если был утверждён — статус сбросится.')) return;
    setBusy('delete'); setErr(null);
    try { await api.deleteTTSJob(jobId); await reload(); refreshJobs(); }
    catch (e) { setErr(asMessage(e)); }
    finally   { setBusy(false); }
  };

  // Trim the leading "понь" reference-bleed artifact (reversible). A clean
  // render with no artifact is reported back untouched.
  const trimArtifact = async (jobId: string) => {
    setBusy('trim'); setErr(null); setNotice(null);
    try {
      const r = await api.trimTTSArtifact(jobId);
      setNotice(r.trimmed
        ? `«Понь» обрезан (−${r.cutMs ?? '?'} мс).`
        : `«Понь» не найден — файл не тронут${r.reason ? ` (${r.reason})` : ''}.`);
      refreshJobs();
    } catch (e) { setErr(asMessage(e)); }
    finally   { setBusy(false); }
  };

  const revertArtifact = async (jobId: string) => {
    setBusy('trim'); setErr(null); setNotice(null);
    try { await api.revertTTSArtifact(jobId); setNotice('Оригинал восстановлен.'); refreshJobs(); }
    catch (e) { setErr(asMessage(e)); }
    finally   { setBusy(false); }
  };

  return (
    <main className="px-4 sm:px-8 py-6 space-y-4">
      {err && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 text-xs font-mono whitespace-pre-wrap break-all">
          {err}
        </div>
      )}
      {notice && (
        <div className="bg-zinc-800/60 border border-zinc-600 rounded p-2 text-zinc-200 text-xs flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>
      )}

      {/* Engine banner — quick visual hint of which engine drives this project */}
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span>Engine:</span>
        <span className={engine !== 'silero' ? 'text-emerald-300' : 'text-zinc-300'}>
          {engine === 'silero' ? TTS_ENGINE_LABELS.silero : `${TTS_ENGINE_LABELS[engine]} (voice clone)`}
        </span>
        {engine !== 'silero' && !project?.ttsVoiceRefPath && (
          <span className="text-amber-400">— загрузи voice-reference в настройках проекта</span>
        )}
      </div>

      {/* Editor */}
      <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что говорит диктор поверх этого кадра."
          rows={4}
          className="w-full bg-zinc-950 border border-zinc-800 rounded p-3 text-sm text-zinc-200 font-sans resize-y"
        />

        <div className="flex items-center gap-3 flex-wrap">
          {engine === 'silero' && (
            <label className="text-xs flex items-center gap-2">
              <span className="text-zinc-500 uppercase tracking-wider">Голос</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as TTSVoice)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
              >
                {(Object.keys(SILERO_VOICE_LABELS) as TTSVoice[]).map((v) => (
                  <option key={v} value={v}>{SILERO_VOICE_LABELS[v]}</option>
                ))}
              </select>
            </label>
          )}

          {engine !== 'silero' && (
            <label className="text-xs flex items-center gap-2">
              <span className="text-zinc-500 uppercase tracking-wider">Эмоция</span>
              {emotionRefs.length > 0 ? (
                <select
                  value={emotionRefName}
                  onChange={(e) => setEmotionRefName(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                >
                  <option value="">— нейтрально (голос-референс) —</option>
                  {emotionRefs.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-zinc-500">
                  нет референсов —{' '}
                  <a href={`/projects/${projectId}/settings`} className="text-emerald-400 hover:underline">
                    загрузить в настройках
                  </a>
                </span>
              )}
            </label>
          )}

          {engine === 'f5' && (
            <label className="text-xs flex items-center gap-2">
              <span className="text-zinc-500 uppercase tracking-wider">Скорость</span>
              <input
                type="range"
                min={0.5} max={2.0} step={0.05}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-32"
              />
              <span className="text-zinc-400 font-mono w-12 text-right">{speed.toFixed(2)}×</span>
            </label>
          )}
          {(engine === 'f5' || engine === 'qwen3') && (
            <label className="text-xs flex items-center gap-2">
              <span className="text-zinc-500 uppercase tracking-wider">Пауза</span>
              <input
                type="number"
                min={0} max={30} step={0.5}
                value={pause}
                onChange={(e) => setPause(Math.max(0, Math.min(30, parseFloat(e.target.value) || 0)))}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 font-mono w-16"
              />
              <span className="text-zinc-600 text-[10px]">сек/предложение</span>
            </label>
          )}

          <div className="ml-auto flex gap-2">
            {dirty && (
              <button
                onClick={save}
                disabled={busy !== false}
                className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-xs px-3 py-1.5 rounded"
                title="Сохранить текст без синтеза"
              >
                {busy === 'save' ? '⏳' : '💾'}
              </button>
            )}
            <label
              className="flex items-center gap-1.5 text-xs text-zinc-400 self-center cursor-pointer select-none"
              title="Поставить этот синтез в начало очереди. По умолчанию — в конец (обычная очередь)."
            >
              <input
                type="checkbox"
                checked={front}
                onChange={(e) => setFront(e.target.checked)}
                className="accent-emerald-600"
              />
              в начало очереди
            </label>
            <button
              onClick={synth}
              disabled={!canSynth}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-sm font-medium px-4 py-1.5 rounded"
              title={engine !== 'silero' && !project?.ttsVoiceRefPath
                ? 'Сначала загрузи voice-reference в настройках проекта'
                : ''}
            >
              {busy === 'render' ? '⏳' : '▶ Синтез'}
            </button>
          </div>
        </div>
      </section>

      {/* History — the approved take is highlighted inline (no separate block). */}
      <section className="bg-zinc-900 border border-zinc-800 rounded">
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
        >
          <span>{historyOpen ? '▼' : '▶'}</span>
          <span>История</span>
          {jobs && <span className="text-zinc-600">({jobs.length})</span>}
        </button>
        {historyOpen && (
          <div className="px-4 pb-3 space-y-2">
            {!jobs && <p className="text-zinc-500 text-sm">Загрузка…</p>}
            {jobs && jobs.length === 0 && (
              <p className="text-zinc-500 text-sm italic">— пока нет ни одной озвучки —</p>
            )}
            {jobs && jobs.map((j) => {
              const isApproved = j.id === approvedId;
              return (
                /* flex-wrap: на телефоне мета + плеер + 3-4 кнопки не влезают в
                   один ряд, и без переноса «утвердить»/«✕» уезжали за экран. */
                <div key={j.id} className={
                  `flex flex-wrap items-center gap-x-3 gap-y-2 p-2 rounded border ${isApproved ? 'border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/50' : 'border-zinc-800'}`
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
                  <span className="text-xs font-mono text-zinc-400">{jobMetaLabel(j)}</span>
                  {j.voVerdict && <VoQcBadge v={j.voVerdict} />}
                  {j.status === 'completed' && (
                    /* w-full on a phone: flex-1 cannot shrink a native iOS audio
                       control below its intrinsic width, so it overflowed the row
                       and h-7 clipped its transport. Own line on mobile, inline
                       from sm up. */
                    <audio controls preload="none" src={api.ttsFileUrl(j.id)}
                           className="w-full sm:flex-1 sm:max-w-md h-10 sm:h-7" />
                  )}
                  {j.status === 'failed' && (
                    <span className="text-[10px] text-red-300/70 font-mono truncate flex-1">{j.errorMessage}</span>
                  )}
                  <span className="text-[10px] text-zinc-600 ml-auto">{new Date(j.queuedAt).toLocaleTimeString()}</span>
                  {j.status === 'completed' && !isApproved && (
                    <button onClick={() => approve(j.id)} disabled={busy !== false}
                      className="text-[11px] bg-emerald-700 hover:bg-emerald-600 text-white px-3 sm:px-2 min-h-9 sm:min-h-0 py-0.5 rounded">
                      утвердить
                    </button>
                  )}
                  {isApproved && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] text-emerald-300 font-medium">✓ выбрано</span>
                      <button onClick={clearApproval} disabled={busy !== false}
                        className="text-[10px] text-zinc-500 hover:text-red-300 px-2 sm:px-0 min-h-9 sm:min-h-0"
                        title="Снять выбор">снять</button>
                    </span>
                  )}
                  {/* Обрезка призвука: только утверждённый дубль И только голос
                      с профилем (bleedProfile). Уже обрезанный файл второй раз
                      не режем — детектор принял бы за призвук первое слово. */}
                  {j.status === 'completed' && isApproved && !j.trimmedArtifact && bleedProfile && (
                    <button onClick={() => trimArtifact(j.id)} disabled={busy !== false}
                      title={bleedProfile === 'sha'
                        ? 'Обрезать ведущий призвук «ща» (обратимо)'
                        : 'Обрезать ведущий призвук «понь» (обратимо)'}
                      className="text-[11px] bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-0.5 rounded disabled:opacity-30">
                      ✂ {bleedProfile === 'sha' ? 'ща' : 'понь'}
                    </button>
                  )}
                  {j.status === 'completed' && isApproved && j.trimmedArtifact && (
                    <button onClick={() => revertArtifact(j.id)} disabled={busy !== false}
                      title="Вернуть оригинал (отменить обрезку призвука)"
                      className="text-[11px] bg-amber-800 hover:bg-amber-700 text-white px-2 py-0.5 rounded disabled:opacity-30">
                      ↩ вернуть
                    </button>
                  )}
                  {/* Trim invalidated the verdict — offer a spot re-check (the
                      incremental run never revisits approved takes). */}
                  {j.status === 'completed' && isApproved && j.trimmedArtifact && !j.voVerdict && (
                    <button
                      onClick={async () => { try { await api.revalidateTTSJob(j.id); setNotice('Перепроверка поставлена в очередь.'); } catch (e) { setErr(asMessage(e)); } }}
                      disabled={busy !== false}
                      title="Перепроверить озвучку после обрезки (в очередь)"
                      className="text-[11px] bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-0.5 rounded disabled:opacity-30">
                      🎙 QC
                    </button>
                  )}
                  <button onClick={() => deleteJob(j.id)}
                    disabled={busy !== false || j.status === 'running'}
                    className="text-[11px] text-zinc-500 hover:text-red-400 disabled:opacity-30">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compact VO-QC verdict badge: pass = можно не слушать; warn/fail/error = в
 *  ручную прослушку. Tooltip carries the concrete findings + омографы. */
function VoQcBadge({ v }: { v: VoVerdictView }) {
  const cls =
    v.status === 'pass' ? 'text-emerald-400 border-emerald-800'
    : v.status === 'warn' ? 'text-amber-300 border-amber-800'
    : 'text-red-300 border-red-800';
  const icon = v.status === 'pass' ? '✓' : v.status === 'warn' ? '⚠' : v.status === 'fail' ? '✗' : '?';
  const parts = [
    ...(v.issues ?? []),
    ...(v.riskyStressWords?.length ? [`омографы (проверь ударение): ${v.riskyStressWords.join(', ')}`] : []),
    ...(v.textSnapshotStale ? ['текст шота изменился после рендера'] : []),
  ];
  return (
    <span
      title={parts.length ? parts.join('\n') : 'проверка пройдена'}
      className={`text-[10px] font-mono border rounded px-1 py-px cursor-help ${cls}`}
    >
      QC {icon}{typeof v.score === 'number' ? ` ${v.score}` : ''}
    </span>
  );
}

/** Compact engine-aware one-liner: silero shows voice+sr; voice-clone engines
 *  show emotion-ref (or "нейтрально") + sr, plus speed for f5 when ≠ 1×. */
function jobMetaLabel(j: TTSJob): string {
  const engineLabel = (j as { engine?: string | null }).engine ?? 'silero';
  if (engineLabel !== 'silero') {
    const emo      = (j as { emotionRefName?: string | null }).emotionRefName ?? 'нейтрально';
    // qwen3 has no speed knob — the stored rate never affected the render, so
    // never show it (legacy rows carry the old 0.85 default).
    const speedTag = engineLabel !== 'qwen3' && j.rate && Math.abs(j.rate - 1) >= 0.01 ? ` · ${j.rate}×` : '';
    return `${engineLabel} · ${emo} · ${j.sampleRate}Hz${speedTag}`;
  }
  return `${j.voice} · ${j.sampleRate}Hz`;
}
