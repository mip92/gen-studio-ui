'use client';

import { useEffect, useRef, useState } from 'react';
import {
  api,
  type ProjectFull,
  type ProjectTTSEmotionRef,
  type TTSEngine,
  type Voiceover,
  TTS_ENGINES,
  TTS_ENGINE_LABELS,
} from '@/lib/api';

const INDEXTTS2_PRESETS = ['neutral', 'happy', 'sad', 'angry', 'fear', 'disgust', 'surprise', 'calm'] as const;

const EMOTION_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

interface Props {
  projectId: string;
  /** Initial values from the parent's getProject() call. */
  initialEngine:       string | null;
  initialVoiceRefPath: string | null;
  initialVoiceoverId:  string | null;
  /** Called after a successful engine switch / voice-ref change so the parent
   *  page can refresh its cached ProjectFull row. */
  onProjectUpdated?: (p: { ttsEngine?: string | null; ttsVoiceRefPath?: string | null; ttsVoiceoverId?: string | null }) => void;
}

/**
 * Self-contained TTS panel for the project settings page. Engine toggle,
 * voice-reference uploader (single slot), emotion-reference library.
 * All mutations hit the project-tts controller; nothing relies on the
 * parent's save button.
 */
export function ProjectTTSSettings({ projectId, initialEngine, initialVoiceRefPath, initialVoiceoverId, onProjectUpdated }: Props) {
  const [engine, setEngine]                 = useState<TTSEngine>(((initialEngine ?? 'silero') as TTSEngine));
  const [voiceRefPath, setVoiceRefPath]     = useState<string | null>(initialVoiceRefPath);
  const [voiceoverId, setVoiceoverId]       = useState<string | null>(initialVoiceoverId);
  const [voiceovers, setVoiceovers]         = useState<Voiceover[]>([]);
  const [emotionRefs, setEmotionRefs]       = useState<ProjectTTSEmotionRef[]>([]);
  const [busy, setBusy]                     = useState<string | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [newRefName, setNewRefName]         = useState('');

  const voiceRefInputRef   = useRef<HTMLInputElement>(null);
  const emotionRefInputRef = useRef<HTMLInputElement>(null);

  const reloadVoiceovers = async () => {
    const list = await api.listVoiceovers();
    setVoiceovers(list);
    return list;
  };

  useEffect(() => {
    (async () => {
      try {
        const [refs] = await Promise.all([
          api.listProjectEmotionRefs(projectId),
          reloadVoiceovers(),
        ]);
        setEmotionRefs(refs);
      } catch (e) {
        setError(asMessage(e));
      }
    })();
  }, [projectId]);

  const switchEngine = async (next: TTSEngine) => {
    if (next === engine) return;
    setBusy('engine'); setError(null);
    try {
      const r = await api.setProjectTTSEngine(projectId, next);
      setEngine((r.ttsEngine ?? 'silero') as TTSEngine);
      setVoiceRefPath(r.ttsVoiceRefPath);
      onProjectUpdated?.({ ttsEngine: r.ttsEngine, ttsVoiceRefPath: r.ttsVoiceRefPath });
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // Assign an existing library voice (or unassign with null).
  const onAssignVoiceover = async (id: string | null) => {
    setBusy('voice-ref'); setError(null);
    try {
      const r = await api.assignProjectVoiceover(projectId, id);
      setVoiceoverId(r.ttsVoiceoverId);
      setVoiceRefPath(r.ttsVoiceRefPath);
      onProjectUpdated?.({ ttsVoiceoverId: r.ttsVoiceoverId, ttsVoiceRefPath: r.ttsVoiceRefPath });
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // Upload a NEW clip → lands in the library (dedup by md5) AND assigns it here.
  const onVoiceRefPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy('voice-ref'); setError(null);
    try {
      const r = await api.uploadProjectVoiceRef(projectId, file);
      await reloadVoiceovers();
      setVoiceoverId(r.voiceoverId);
      setVoiceRefPath(r.path);
      onProjectUpdated?.({ ttsVoiceoverId: r.voiceoverId, ttsVoiceRefPath: r.path });
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(null);
      if (voiceRefInputRef.current) voiceRefInputRef.current.value = '';
    }
  };

  const onVoiceRefDelete = async () => {
    if (!confirm('Отвязать голос от проекта? Файл в общей библиотеке останется (его используют и другие проекты). Без голоса voice-clone движок не запустится.')) return;
    await onAssignVoiceover(null);
  };

  const onEmotionRefPick = async (file: File | undefined) => {
    if (!file) return;
    const name = newRefName.trim().toLowerCase();
    if (!EMOTION_NAME_RE.test(name)) {
      setError(`Имя должно соответствовать ${EMOTION_NAME_RE} (буквы a-z, цифры, _, -)`);
      if (emotionRefInputRef.current) emotionRefInputRef.current.value = '';
      return;
    }
    setBusy(`emotion-ref:${name}`); setError(null);
    try {
      const r = await api.uploadProjectEmotionRef(projectId, name, file);
      setEmotionRefs((prev) => {
        const without = prev.filter((x) => x.name !== r.name);
        return [...without, r].sort((a, b) => a.name.localeCompare(b.name));
      });
      setNewRefName('');
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(null);
      if (emotionRefInputRef.current) emotionRefInputRef.current.value = '';
    }
  };

  const onEmotionRefDelete = async (name: string) => {
    if (!confirm(`Удалить emotion-reference "${name}"?`)) return;
    setBusy(`emotion-ref:${name}`); setError(null);
    try {
      await api.deleteProjectEmotionRef(projectId, name);
      setEmotionRefs((prev) => prev.filter((x) => x.name !== name));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // Voice-clone engines (xtts2 | f5) share the same UI: voice-reference slot +
  // emotion-ref library. Silero is the only non-clone engine.
  const isVoiceClone = engine !== 'silero';
  const current = voiceovers.find((v) => v.id === voiceoverId) ?? null;

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-zinc-400">🎙 TTS Engine</h2>
          <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
            Silero — CPU, фиксированные голоса (диктор). XTTS-v2, F5-TTS Russian и Fish S2 Pro —
            GPU, voice cloning по референс-клипу проекта (+ опциональные emotion-refs). F5
            дополнительно авто-расставляет ударения (RUAccent). Fish S2 Pro читает кадр целиком
            (просодия по контексту); первый джоб после простоя ждёт ~5 мин — грузится модель.
            Переключение моментальное; уже отрендеренные wav-файлы переключение не трогает.
          </p>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-2 text-red-200 font-mono text-[11px] whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Engine radio */}
      <div className="flex gap-3">
        {TTS_ENGINES.map((eng) => (
          <button
            key={eng}
            disabled={busy === 'engine'}
            onClick={() => switchEngine(eng)}
            className={
              'px-3 py-2 rounded border text-xs uppercase tracking-wider transition-colors ' +
              (engine === eng
                ? 'bg-emerald-700/40 border-emerald-600 text-emerald-200'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500')
            }
          >
            {TTS_ENGINE_LABELS[eng]}
          </button>
        ))}
        {busy === 'engine' && <span className="text-xs text-zinc-500 self-center">…</span>}
      </div>

      {/* Voice-clone panel (xtts2 | f5) */}
      {isVoiceClone && (
        <div className="border border-zinc-800 rounded p-3 space-y-4">
          {/* Voice reference — assigned from the shared library */}
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Закадровая озвучка (voice)</div>
            <div className="text-[11px] text-zinc-600 mb-2 leading-snug">
              Голос проекта — запись из общей библиотеки. Один голос можно назначить нескольким проектам:
              файл хранится один раз в <code className="text-zinc-500">data/_voices/&lt;slug&gt;/</code>.
              Выбери из списка или загрузи новый (он попадёт в библиотеку; одинаковые по содержимому склеиваются).
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={voiceoverId ?? ''}
                disabled={busy === 'voice-ref'}
                onChange={(e) => onAssignVoiceover(e.target.value || null)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs min-w-[16rem]"
              >
                <option value="">— не назначен —</option>
                {voiceovers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.assignedCount > 1 ? ` · ${v.assignedCount} проекта(ов)` : ''} ({v.ext.replace('.', '')})
                  </option>
                ))}
              </select>
              {busy === 'voice-ref' && <span className="text-xs text-zinc-500 self-center">…</span>}
              {voiceoverId && (
                <button
                  onClick={onVoiceRefDelete}
                  disabled={busy === 'voice-ref'}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-1 rounded disabled:opacity-50"
                >
                  отвязать
                </button>
              )}
              <label className="text-xs text-zinc-400 hover:text-zinc-200 underline cursor-pointer">
                {busy === 'voice-ref' ? '…' : '⬆ загрузить новый в библиотеку'}
                <input ref={voiceRefInputRef} type="file" accept="audio/*" hidden
                  onChange={(e) => onVoiceRefPick(e.target.files?.[0])} />
              </label>
            </div>

            {current ? (
              <div className="mt-2 flex items-center gap-3">
                <audio key={current.id} controls src={api.voiceoverRawUrl(current.id)} className="h-8" />
                <code className="text-[11px] font-mono text-emerald-300/80 truncate">{current.filePath}</code>
              </div>
            ) : voiceRefPath ? (
              <div className="mt-2 text-[11px] text-amber-400/80 font-mono truncate">
                назначен путь вне библиотеки: {voiceRefPath}
              </div>
            ) : null}
          </div>

          {/* Emotion-refs library */}
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Emotion references (опционально)</div>
            <div className="text-[11px] text-zinc-600 mb-2 leading-snug">
              Кастомные клипы интонации — даёт более тонкий контроль чем встроенные 8 пресетов
              ({INDEXTTS2_PRESETS.join(', ')}). 3–8 сек, чистая запись. Имя для autocomplete:
              <code className="text-zinc-500 mx-1">{EMOTION_NAME_RE.source}</code>.
            </div>
            <ul className="space-y-1.5 mb-3">
              {emotionRefs.length === 0 && (
                <li className="text-[11px] text-zinc-600 italic">(нет кастомных ref'ов — используются 8 встроенных пресетов)</li>
              )}
              {emotionRefs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-zinc-300 w-32 shrink-0">{r.name}</span>
                  <code className="font-mono text-zinc-600 truncate flex-1">{r.filePath}</code>
                  <button
                    onClick={() => onEmotionRefDelete(r.name)}
                    disabled={busy === `emotion-ref:${r.name}`}
                    className="text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-0.5 rounded disabled:opacity-50"
                  >
                    {busy === `emotion-ref:${r.name}` ? '…' : '✕'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newRefName}
                onChange={(e) => setNewRefName(e.target.value)}
                placeholder="имя ref'а (e.g. tired)"
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono w-48"
              />
              <label className="inline-block">
                <span className={`text-xs px-3 py-1 rounded cursor-pointer ${
                  newRefName.trim() && EMOTION_NAME_RE.test(newRefName.trim().toLowerCase())
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}>
                  ⬆ добавить
                </span>
                <input ref={emotionRefInputRef} type="file" accept="audio/*" hidden
                  disabled={!newRefName.trim() || !EMOTION_NAME_RE.test(newRefName.trim().toLowerCase())}
                  onChange={(e) => onEmotionRefPick(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
