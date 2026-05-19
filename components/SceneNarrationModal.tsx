'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, SceneShot, TTSJob, TTSSampleRate, TTSVoice } from '../lib/api';

interface Props {
  sceneId:     string;
  sceneTitle:  string;
  /** Project slug — used to fetch the project's full narration script for reference. */
  projectSlug: string;
  /** Current narration text from the scene row — may be null if never set. */
  initialText: string | null;
  /** Currently approved TTSJob id for this scene, or null. Mirrors Scene.approvedTTSJobId. */
  initialApprovedJobId?: string | null;
  /**
   * Scene's shots, used to auto-derive narration text from narrative beats
   * when the user hasn't written anything yet. Each shot's beat is a one-line
   * description of what's happening — joining them gives a usable first draft
   * for the rough voiceover.
   */
  shots?:      SceneShot[];
  onClose:     () => void;
}

/** Build a rough narration draft from per-shot narrative beats. */
function deriveDraftFromBeats(shots: SceneShot[] | undefined): string {
  if (!shots || shots.length === 0) return '';
  return shots
    .map((s) => s.beat?.trim())
    .filter((b): b is string => !!b && b.length > 0)
    .join('\n\n');
}

const VOICE_LABELS: Record<TTSVoice, string> = {
  eugene:  'Eugene (м, спокойный диктор)',
  aidar:   'Aidar (м, уверенный)',
  baya:    'Baya (ж, нейтральная)',
  kseniya: 'Kseniya (ж, мягкая)',
  xenia:   'Xenia (ж, выразительная)',
  ruslan:  'Ruslan (м, бас) — только V3/V4',
  random:  'Random (новый голос каждый раз) — лучше всего на V3',
};

const SAMPLE_RATES: TTSSampleRate[] = [48000, 24000, 8000];

// Discrete speed presets for documentary narration. 0.9 (чуть медленнее
// нормы) is the sweet spot for Russian voiceover — clear articulation
// without sounding sleepy. 0.85 проверено на слух — слишком медленно.
const RATE_PRESETS: { value: number; label: string }[] = [
  { value: 0.70, label: '0.7× — очень медленно' },
  { value: 0.85, label: '0.85× — медленно' },
  { value: 0.90, label: '0.9× — чуть медленнее (рекомендую для документалки)' },
  { value: 1.00, label: '1.0× — нормально' },
  { value: 1.15, label: '1.15× — быстро' },
  { value: 1.30, label: '1.3× — очень быстро' },
];

export function SceneNarrationModal({ sceneId, sceneTitle, projectSlug, initialText, initialApprovedJobId, shots, onClose }: Props) {
  const draftFromBeats = useMemo(() => deriveDraftFromBeats(shots), [shots]);
  // Pre-fill: if the scene already has a saved narrationText, use it.
  // Otherwise drop in the auto-derived draft from shot beats so the textarea
  // isn't empty — user starts editing, not from scratch.
  const [text,       setText]       = useState(initialText?.trim() || draftFromBeats);
  const [voice,      setVoice]      = useState<TTSVoice>('eugene');
  const [sampleRate, setSampleRate] = useState<TTSSampleRate>(48000);
  // Default slightly-slow — 0.9× is the sweet spot for documentary narration
  // (0.85 was tested and sounded too sleepy).
  const [rate,       setRate]       = useState<number>(0.90);
  // Silence after every sentence — documentary style benefits from explicit
  // breathing room between beats. 5s is the user-requested default.
  const [sentencePauseSec, setSentencePauseSec] = useState<number>(5);

  // Available .pt models scanned from .silero_cache/ by the backend. modelFilename
  // = empty string means "backend default (V5_5 first)". When a model with a
  // smaller voice set is picked, the voice dropdown is filtered to its voices.
  const [models,         setModels]      = useState<Array<{ filename: string; sizeBytes: number; voices: TTSVoice[] }>>([]);
  const [modelFilename,  setModelFile]   = useState<string>('');
  useEffect(() => {
    api.listTTSModels().then(setModels).catch(() => setModels([]));
  }, []);
  const activeModel  = models.find((m) => m.filename === modelFilename);
  const availableVoices: TTSVoice[] = activeModel
    ? activeModel.voices
    : (Object.keys(VOICE_LABELS) as TTSVoice[]);
  // Snap voice back to the first allowed one when switching to a narrower model.
  useEffect(() => {
    if (!availableVoices.includes(voice)) setVoice(availableVoices[0] ?? 'eugene');
  }, [availableVoices, voice]);

  // Full project narration script (Markdown) — fetched once, shown read-only in
  // a collapsible reference panel so the user can copy relevant fragments into
  // the textarea per scene.
  const [script,      setScript]      = useState<{ text: string | null } | null>(null);
  const [scriptOpen,  setScriptOpen]  = useState(false);
  useEffect(() => {
    api.getProjectScript(projectSlug)
      .then(setScript)
      .catch(() => setScript({ text: null }));
  }, [projectSlug]);

  // Insert the user-selected fragment from the script panel into the textarea.
  const insertSelectionFromScript = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      alert('Выдели в панели сценария кусок текста.');
      return;
    }
    const fragment = sel.toString().trim();
    if (!fragment) return;
    setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${fragment}` : fragment));
    sel.removeAllRanges();
  };

  const [jobs,      setJobs]   = useState<TTSJob[] | null>(null);
  const [busy,      setBusy]   = useState<false | 'save' | 'render' | 'approve' | 'delete'>(false);
  const [saveError, setSaveErr] = useState<string | null>(null);
  const [runError,  setRunErr]  = useState<string | null>(null);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  // Approved job id — starts from the SceneSummary prop, then tracked locally
  // so the approve/clear buttons feel instant. Server is source of truth on
  // re-open (ScenesList refreshes on close).
  const [approvedJobId, setApprovedJobId] = useState<string | null>(initialApprovedJobId ?? null);

  const refresh = useCallback(() => {
    api.listTTSJobs(sceneId).then(setJobs).catch(() => setJobs([]));
  }, [sceneId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live poll while anything is in flight.
  useEffect(() => {
    if (!jobs) return;
    const inFlight = jobs.some((j) => j.status === 'pending' || j.status === 'running');
    if (!inFlight) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [jobs, refresh]);

  const saveText = async () => {
    setBusy('save'); setSaveErr(null);
    try {
      await api.setSceneNarrationText(sceneId, text);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const render = async () => {
    setBusy('render'); setRunErr(null);
    try {
      // Save first so a later open re-uses the same text.
      await api.setSceneNarrationText(sceneId, text);
      await api.startTTS(sceneId, {
        voice,
        sampleRate,
        rate,
        sentencePauseSec,
        ...(modelFilename ? { modelFilename } : {}),
      });
      refresh();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approveJob = async (jobId: string) => {
    setBusy('approve'); setApproveErr(null);
    try {
      const res = await api.approveTTSJob(jobId);
      setApprovedJobId(res.approvedTTSJobId ?? jobId);
    } catch (e) {
      setApproveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearApproval = async () => {
    setBusy('approve'); setApproveErr(null);
    try {
      await api.clearTTSApproval(sceneId);
      setApprovedJobId(null);
    } catch (e) {
      setApproveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить эту запись насовсем? Файл .wav тоже сотрётся.')) return;
    setBusy('delete'); setDeleteErr(null);
    try {
      await api.deleteTTSJob(jobId);
      if (approvedJobId === jobId) setApprovedJobId(null);
      refresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-zinc-800 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">
            🔊 Озвучка сцены — <span className="text-zinc-400 font-normal">{sceneTitle}</span>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
        </header>

        <div className="p-5 space-y-5">
          {/* Narration text */}
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-zinc-500">Текст закадра (русский)</label>
              <span className="text-xs text-zinc-600">{text.length} символов · ≈{Math.round(text.length / 15)} сек</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Текст для Silero V5 ru. Ударения и ё расставляются автоматически."
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono"
            />
            <div className="mt-2 flex gap-2 items-center flex-wrap">
              <button
                onClick={saveText}
                disabled={busy !== false}
                className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs px-3 py-1 rounded"
              >
                {busy === 'save' ? '⏳ сохраняем…' : '💾 сохранить текст'}
              </button>
              {draftFromBeats && (
                <button
                  onClick={() => {
                    if (text.trim() && !confirm('Перезаписать текст черновиком из сценария? Текущая версия пропадёт.')) return;
                    setText(draftFromBeats);
                  }}
                  disabled={busy !== false}
                  title="Собрать из narrative beats всех кадров сцены"
                  className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 text-xs px-3 py-1 rounded"
                >
                  🪄 заполнить из сценария
                </button>
              )}
              {saveError && <span className="text-red-400 text-xs">{saveError}</span>}
            </div>
          </section>

          {/* Full-script reference panel */}
          {script?.text && (
            <section className="bg-zinc-950/50 border border-zinc-800 rounded">
              <button
                onClick={() => setScriptOpen((v) => !v)}
                className="w-full px-3 py-2 flex items-center justify-between text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
              >
                <span>📖 Полный сценарий проекта</span>
                <span>{scriptOpen ? '▾' : '▸'}</span>
              </button>
              {scriptOpen && (
                <div className="border-t border-zinc-800 p-3 space-y-2">
                  <button
                    onClick={insertSelectionFromScript}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-3 py-1 rounded"
                  >
                    ↓ вставить выделенное в наррацию
                  </button>
                  <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto select-text leading-relaxed">
                    {script.text}
                  </pre>
                </div>
              )}
            </section>
          )}

          {/* Model + voice + speed + sample rate */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Модель Silero</span>
              <select
                value={modelFilename}
                onChange={(e) => setModelFile(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                <option value="">авто (V5_5 если есть, иначе по приоритету)</option>
                {models.map((m) => (
                  <option key={m.filename} value={m.filename}>
                    {m.filename} ({Math.round(m.sizeBytes / 1024 / 1024)} MB · {m.voices.length} голос{m.voices.length === 1 ? '' : m.voices.length < 5 ? 'а' : 'ов'})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Голос</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as TTSVoice)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                {availableVoices.map((v) => (
                  <option key={v} value={v}>{VOICE_LABELS[v] ?? v}</option>
                ))}
              </select>
            </label>
          </section>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Скорость</span>
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                {RATE_PRESETS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider" title="Пауза после каждого предложения. Текст бьётся по [.!?…], каждый кусок синтезируется отдельно, между ними вставляется тишина.">
                Пауза после фразы
              </span>
              <select
                value={sentencePauseSec}
                onChange={(e) => setSentencePauseSec(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                <option value={0}>0 — без паузы</option>
                <option value={1}>1 сек</option>
                <option value={2}>2 сек</option>
                <option value={3}>3 сек</option>
                <option value={5}>5 сек — документалка (дефолт)</option>
                <option value={7}>7 сек</option>
                <option value={10}>10 сек</option>
                <option value={15}>15 сек</option>
              </select>
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-zinc-500 uppercase tracking-wider">Sample rate</span>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value) as TTSSampleRate)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                {SAMPLE_RATES.map((sr) => (
                  <option key={sr} value={sr}>{sr} Hz</option>
                ))}
              </select>
            </label>
          </section>

          {/* Render button */}
          <section>
            <button
              onClick={render}
              disabled={busy !== false || text.trim().length === 0}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
            >
              {busy === 'render' ? '⏳ ставим в очередь…' : '🔊 озвучить (Silero V5 ru)'}
            </button>
            {runError && <span className="ml-3 text-red-400 text-xs">{runError}</span>}
          </section>

          {/* Past jobs — failed/cancelled are hidden by default (user has explicitly
              said they don't care about them); a tiny "+N упавших" hint at the top
              of the list keeps them recoverable without dominating the UI. */}
          <section>
            {(() => {
              const visible = (jobs ?? []).filter((j) => j.status !== 'failed' && j.status !== 'cancelled');
              const hidden  = (jobs ?? []).length - visible.length;
              return (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-xs uppercase tracking-wider text-zinc-500">
                      История ({visible.length}{hidden > 0 ? ` · +${hidden} скрыто` : ''})
                    </h3>
                    {approvedJobId && (
                      <button
                        onClick={clearApproval}
                        disabled={busy !== false}
                        className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-red-300 disabled:opacity-30"
                        title="Снять отметку «утверждено»"
                      >
                        снять approve
                      </button>
                    )}
                  </div>
                  {approveErr && <p className="text-red-400 text-xs mb-2">{approveErr}</p>}
                  {deleteErr  && <p className="text-red-400 text-xs mb-2">{deleteErr}</p>}
                  {jobs === null && <p className="text-zinc-600 text-sm">Loading…</p>}
                  {jobs && visible.length === 0 && (
                    <p className="text-zinc-600 text-sm italic">
                      {hidden > 0 ? `Все ${hidden} попытки упали — нажми «озвучить» ещё раз.` : 'Ещё не запускали.'}
                    </p>
                  )}
                  <div className="space-y-2">
                    {visible.map((j) => (
                      <TTSJobRow
                        key={j.id}
                        job={j}
                        isApproved={j.id === approvedJobId}
                        onApprove={() => approveJob(j.id)}
                        onDelete={() => deleteJob(j.id)}
                        busy={busy === 'approve' || busy === 'delete'}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
      </div>
    </div>
  );
}

function TTSJobRow({
  job,
  isApproved,
  onApprove,
  onDelete,
  busy,
}: {
  job:        TTSJob;
  isApproved: boolean;
  onApprove:  () => void;
  onDelete:   () => void;
  busy:       boolean;
}) {
  const isReady = job.status === 'completed' && job.outputFilename;
  return (
    <div className={`border rounded p-3 text-xs ${isApproved
      ? 'bg-emerald-950/30 border-emerald-700'
      : 'bg-zinc-950 border-zinc-800'}`}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <StatusBadge status={job.status} />
        {isApproved && (
          <span className="text-emerald-300 bg-emerald-900/40 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
            ✓ approved
          </span>
        )}
        <span className="text-zinc-400 font-mono">{job.voice} · {job.sampleRate} Hz · {job.rate}×</span>
        {job.sentencePauseSec > 0 && (
          <span className="text-amber-300/70 font-mono text-[10px]" title="Пауза после каждого предложения">⏸ {job.sentencePauseSec}s</span>
        )}
        {job.modelFilename && (
          <span className="text-zinc-500 font-mono text-[10px]">{job.modelFilename.replace(/\.pt$/, '')}</span>
        )}
        <span className="text-zinc-600">{new Date(job.queuedAt).toLocaleString()}</span>
        <div className="ml-auto flex items-center gap-2">
          {isReady && !isApproved && (
            <button
              onClick={onApprove}
              disabled={busy}
              className="bg-emerald-800 hover:bg-emerald-700 disabled:opacity-30 text-white text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
              title="Утвердить эту запись как финальную для сцены"
            >
              ✓ approve
            </button>
          )}
          {job.status !== 'running' && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="bg-red-900/40 hover:bg-red-800 disabled:opacity-30 text-red-200 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
              title="Удалить запись и .wav-файл"
            >
              ✕ удалить
            </button>
          )}
        </div>
      </div>
      {isReady && (
        <audio
          src={api.ttsFileUrl(job.id)}
          controls
          className="w-full mt-2"
        />
      )}
      {job.status === 'failed' && job.errorMessage && (
        <pre className="mt-2 text-red-400 whitespace-pre-wrap font-mono text-[10px]">{job.errorMessage}</pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: TTSJob['status'] }) {
  const map: Record<TTSJob['status'], { label: string; cls: string }> = {
    pending:   { label: '⏳ pending',   cls: 'text-amber-300 bg-amber-900/40' },
    running:   { label: '⚙ running',   cls: 'text-blue-300 bg-blue-900/40' },
    completed: { label: '✓ completed', cls: 'text-emerald-300 bg-emerald-900/40' },
    failed:    { label: '✕ failed',    cls: 'text-red-300 bg-red-900/40' },
    cancelled: { label: '○ cancelled', cls: 'text-zinc-400 bg-zinc-800/40' },
  };
  const m = map[status] ?? { label: status, cls: 'text-zinc-300 bg-zinc-800/40' };
  return <span className={`${m.cls} text-[10px] uppercase tracking-wider px-2 py-0.5 rounded`}>{m.label}</span>;
}
