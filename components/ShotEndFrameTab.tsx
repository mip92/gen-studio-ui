'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, EndFrameState } from '../lib/api';
import { useShotCtx } from './ShotPageShell';
import { QueuedTiles } from './ShotDetail';
import { useLiveEvents, on } from '../lib/liveEvents';

/**
 * The shot's END frame — the second conditioning image of a two-frame (flf2v)
 * clip.
 *
 * The page is built around one idea the render depends on: the end frame is an
 * EDIT of the first frame, not a new picture. So the two are always shown side
 * by side at the same size — the only useful question about a candidate is
 * "is this the same shot a moment later, or is it a different shot", and that is
 * a question you can only answer by looking at the pair.
 */
export function ShotEndFrameTab() {
  const { shot, setShot, shotId } = useShotCtx();

  const [state,  setState]  = useState<EndFrameState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.listEndFrames(shotId);
      setState(s);
      setPrompt(s.prompt ?? '');
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [shotId]);

  useEffect(() => { load(); }, [load]);

  // Anything in flight → keep refreshing, so the placeholders turn into pictures
  // without the user hunting for the «Обновить» button. Server-side state, so it
  // works after a reload too — the whole point of the placeholders.
  const pendingJobs     = state?.pending?.jobs ?? 0;
  const pendingExpected = state?.pending?.expected ?? 0;
  const efMatch = useCallback(on.all(on.shot(shotId), on.types('end_frame')), [shotId]);
  useLiveEvents(efMatch, load, { active: pendingJobs > 0 });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const savePrompt = () => run(async () => {
    const updated = await api.updateShot(shotId, { endFramePrompt: prompt.trim() || null });
    setShot(updated);
    await load();
    setNotice('Инструкция сохранена');
  });

  // One action, one queue entry, five candidates — same as the Рендер tab.
  const enqueue = () => run(async () => {
    await api.enqueueEndFrame(shotId);
    setNotice('Поставлено в очередь: один джоб, пять вариантов');
  });

  const choose = (filename: string) => run(async () => {
    const updated = await api.chooseEndFrame(shotId, filename);
    setShot(updated);
    await load();
  });

  const approve = () => run(async () => {
    const updated = await api.approveEndFrame(shotId);
    setShot(updated);
    await load();
    setNotice('Последний кадр утверждён — кадр поедет на 2 кадрах');
  });

  // The shot's own column only says "inherit"; the value that actually decides
  // comes resolved from the API (shot → act → project). The switch itself lives
  // in the shot header (`VideoFlowToggle`) — one control for the field instead
  // of a second copy on this page, and it is on screen from every tab.
  const effectiveFlow = state?.flow ?? null;
  const twoFrame = effectiveFlow === 'flf2v';
  const promptDirty = (state?.prompt ?? '') !== prompt;

  return (
    <main className="px-4 sm:px-8 py-6 space-y-6">
      {error  && <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-sm">{error}</div>}
      {notice && <div className="bg-emerald-900/30 border border-emerald-800 rounded p-3 text-emerald-200 text-sm">{notice}</div>}

      {/* On the one-frame flow nothing downstream reads an end frame, so the page
          says so plainly instead of offering a render that would be thrown away. */}
      {effectiveFlow === 'i2v' && (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded p-3 text-zinc-300 text-sm">
          Этот кадр рендерится <b>по одному кадру</b> — последний кадр ему не нужен и
          использован не будет. Чтобы он появился в клипе, переключи «Флоу» на
          «2 кадра» в шапке кадра — или смени дефолт у акта либо у проекта.
        </div>
      )}

      {twoFrame && !shot.chosenRender && (
        <div className="bg-amber-900/30 border border-amber-800 rounded p-3 text-amber-200 text-sm">
          У кадра нет утверждённого рендера. Последний кадр — это правка первого,
          так что сначала нужно выбрать картинку на вкладке «Рендер».
        </div>
      )}

      {/* ── Instruction ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">Что изменилось через несколько секунд</h2>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Опиши <b>только разницу</b>, по-английски, готовым кадром, а не приказом:
          «she is standing, palm flat on the door handle». Не переписывай сюда сцену,
          свет и внешность — они приезжают из самой картинки, а лишние слова у
          редактора отнимают бюджет. Камера, ракурс и одежда меняться не должны:
          если последний кадр снят с другой точки, Wan потратит клип на переезд
          между двумя ракурсами вместо движения.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder="she is standing, palm flat on the door handle"
          className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 font-mono text-sm text-zinc-200 disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy || !promptDirty} onClick={savePrompt}
                  className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm">
            Сохранить
          </button>
          {promptDirty && (
            <span className="text-xs text-amber-400">
              Изменение инструкции сбросит выбор и утверждение — картинка на диске отвечает на старую.
            </span>
          )}
        </div>
      </section>

      {/* ── Render ──────────────────────────────────────────────────────── */}
      {twoFrame && (
        <section className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
          <button type="button"
                  disabled={busy || pendingJobs > 0 || !shot.chosenRender || !(state?.prompt ?? '').trim()}
                  onClick={enqueue}
                  className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm">
            {pendingJobs > 0 ? `⏳ в очереди — ждём ${pendingExpected}…` : 'Сгенерировать 5 вариантов'}
          </button>
          <button type="button" onClick={() => void load()} disabled={busy}
                  className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 text-sm">
            Обновить
          </button>
          <span className="text-xs text-zinc-500">
            Одна строка в очереди на всю пачку (Qwen-Image-Edit 2511) — обнови через минуту.
          </span>
        </section>
      )}

      {/* ── The pair ────────────────────────────────────────────────────── */}
      {state?.chosen && shot.chosenRender && (
        <section className="border-t border-zinc-800 pt-4 space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-300">Пара кадров</h2>
            {state.approvedAt
              ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-700 text-emerald-300">утверждён</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">не утверждён</span>}
            {!state.approvedAt && (
              <button type="button" disabled={busy} onClick={approve}
                      className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs">
                Утвердить
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Framed label="первый кадр" src={api.shotImageUrl(shot.id, shot.chosenRender)} />
            <Framed label="последний кадр" src={api.endFrameImageUrl(shot.id, state.chosen)} />
          </div>
        </section>
      )}

      {/* ── Candidates ──────────────────────────────────────────────────── */}
      <section className="border-t border-zinc-800 pt-4 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">
          Кандидаты {state ? `(${state.candidates.length}${pendingExpected > 0 ? ` + ${pendingExpected} в очереди` : ''})` : ''}
        </h2>
        {state && state.candidates.length === 0 && pendingExpected === 0 && (
          <p className="text-sm text-zinc-500">Пока ничего не отрендерено.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {(state?.candidates ?? []).map((c) => {
            const isChosen = c.filename === state?.chosen;
            return (
              <button key={c.filename} type="button" disabled={busy} onClick={() => choose(c.filename)}
                      className={`text-left rounded border overflow-hidden transition-colors disabled:opacity-50 ${
                        isChosen ? 'border-emerald-500' : 'border-zinc-700 hover:border-zinc-500'
                      }`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api.endFrameImageUrl(shot.id, c.filename)} alt={c.filename}
                     className="w-full aspect-video object-cover bg-zinc-900" />
                <div className="px-2 py-1 text-[11px] font-mono text-zinc-400 truncate">
                  {isChosen ? '✓ ' : ''}{c.filename}
                </div>
              </button>
            );
          })}
          <QueuedTiles count={pendingExpected} />
        </div>
      </section>
    </main>
  );
}

function Framed({ label, src }: { label: string; src: string }) {
  return (
    <figure className="space-y-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="w-full rounded border border-zinc-700 bg-zinc-900" />
      <figcaption className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</figcaption>
    </figure>
  );
}
