'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type VoiceSource } from '../lib/api';
import { AudioTrimmer } from './AudioTrimmer';

/**
 * Add a voice to the library from a YouTube link OR a local file, with a
 * waveform trim step in between. The source is fetched/uploaded to the server
 * first (so the waveform loads over the LAN, e.g. from a tablet), trimmed
 * server-side on save, and the untrimmed source is retained for later re-trim.
 * Mirrors the CreateSceneModal overlay/card pattern.
 */
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export function AddVoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [url, setUrl]       = useState('');
  const [name, setName]     = useState('');
  const [source, setSource] = useState<VoiceSource | null>(null);
  const [busy, setBusy]     = useState<null | 'youtube' | 'upload' | 'save'>(null);
  const [error, setError]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trim    = useRef<{ startMs: number; endMs: number }>({ startMs: 0, endMs: 0 });

  // Best-effort: if the modal unmounts (in-app nav, etc.) with a staged source
  // that was never saved, drop it server-side so it isn't orphaned on disk.
  // (A server-side sweep is the durable backstop for tab-close/crash.)
  const tokenRef = useRef<string | null>(null);
  const savedRef = useRef(false);
  useEffect(() => { tokenRef.current = source?.token ?? null; }, [source]);
  useEffect(() => () => {
    if (tokenRef.current && !savedRef.current) api.discardVoiceSource(tokenRef.current).catch(() => {});
  }, []);

  const close = async () => {
    if (source && busy !== 'save') { try { await api.discardVoiceSource(source.token); } catch { /* noop */ } }
    onClose();
  };

  const reset = async () => {
    if (source) { try { await api.discardVoiceSource(source.token); } catch { /* noop */ } }
    setSource(null); setError(null);
  };

  const fromYoutube = async () => {
    if (!url.trim() || busy) return;
    setBusy('youtube'); setError(null);
    try {
      const s = await api.extractYoutubeSource(url.trim());
      setSource(s);
      setName((n) => n.trim() || s.title || '');
    } catch (e) { setError(msg(e)); } finally { setBusy(null); }
  };

  const fromFile = async (file?: File) => {
    if (!file) return;
    setBusy('upload'); setError(null);
    try {
      const s = await api.uploadVoiceSource(file);
      setSource(s);
      setName((n) => n.trim() || s.title || '');
    } catch (e) { setError(msg(e)); } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!source || busy) return;
    setBusy('save'); setError(null);
    try {
      await api.saveVoiceFromSource(source.token, {
        name:    name.trim() || undefined,
        startMs: trim.current.startMs,
        endMs:   trim.current.endMs,
      });
      savedRef.current = true;
      onCreated();
      onClose();
    } catch (e) { setError(msg(e)); setBusy(null); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Добавить голос в библиотеку</h2>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
              {error}
            </div>
          )}

          {!source && (
            <>
              {/* From YouTube */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Ссылка на YouTube</label>
                <div className="flex gap-2">
                  <input value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=…"
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-2 text-sm font-mono" />
                  <button onClick={fromYoutube} disabled={!url.trim() || !!busy}
                    className={`text-sm px-4 py-2 rounded whitespace-nowrap ${
                      url.trim() && !busy ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}>
                    {busy === 'youtube' ? 'Извлекаю…' : '⤓ Извлечь аудио'}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600">Аудиодорожка скачивается на сервер, дальше выберешь фрагмент на волне.</p>
              </div>

              <div className="flex items-center gap-3 text-zinc-600 text-xs">
                <span className="flex-1 border-t border-zinc-800" /> или <span className="flex-1 border-t border-zinc-800" />
              </div>

              {/* From file */}
              <div>
                <label className={`inline-block text-sm px-4 py-2 rounded cursor-pointer ${
                  busy ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
                }`}>
                  {busy === 'upload' ? 'Загрузка…' : '📁 Выбрать аудиофайл'}
                  <input ref={fileRef} type="file" accept="audio/*" hidden disabled={!!busy}
                    onChange={(e) => fromFile(e.target.files?.[0])} />
                </label>
              </div>
            </>
          )}

          {source && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500">Имя голоса</label>
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="напр. Захар (мужской, низкий)"
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-2 text-sm w-full" />
                </div>
                <button onClick={reset} disabled={busy === 'save'}
                  className="text-xs text-zinc-400 hover:text-zinc-200 underline self-end pb-2 disabled:opacity-40">
                  другой источник
                </button>
              </div>

              <AudioTrimmer
                src={api.voiceSourceStreamUrl(source.token)}
                onChange={(startMs, endMs) => { trim.current = { startMs, endMs }; }}
                disabled={busy === 'save'}
              />

              <div className="flex items-center gap-3 border-t border-zinc-800 pt-4">
                <button onClick={save} disabled={busy === 'save'}
                  className={`text-sm px-4 py-2 rounded ${
                    busy === 'save' ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  }`}>
                  {busy === 'save' ? 'Сохранение…' : '✓ Обрезать и сохранить'}
                </button>
                <button onClick={close} disabled={busy === 'save'}
                  className="text-sm px-4 py-2 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-40">
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
