'use client';

import { useCallback, useEffect, useMemo, useState, use } from 'react';
import { api, CaptionSpec, ThumbnailIdeaInput, ThumbnailIdeaJob, ThumbnailJob } from '@/lib/api';

const POLL_MS = 3000;
const ACTIVE = new Set(['pending', 'running']);

const STATUS_RU: Record<string, string> = {
  pending:   'в очереди',
  running:   'рендерится',
  completed: 'готово',
  failed:    'ошибка',
  cancelled: 'отменено',
};

/** Mirrors the defaults in scripts/render_caption.py, so the form shows what
 *  the overlay will actually draw. */
const DEFAULT_CAPTION: CaptionSpec = {
  lines:        [''],
  accent_word:  '',
  accent_color: '#E01B24',
  position:     'bottom',
  align:        'center',
  width_pct:    88,
};

const input = 'bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 ' +
              'placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600';

export default function ThumbnailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);

  const [jobs, setJobs]       = useState<ThumbnailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  /** Which candidate the caption will land on. */
  const [picked, setPicked]     = useState<{ jobId: string; filename: string } | null>(null);
  /** Full-size view: [jobId, filename] or 'cover'. */
  const [lightbox, setLightbox] = useState<{ jobId: string; filename: string } | 'cover' | null>(null);
  const [caption, setCaption]   = useState<CaptionSpec>(DEFAULT_CAPTION);
  /** Recaptioning rewrites the same path, so the <img> needs a cache-buster. */
  const [coverBust, setCoverBust] = useState(Date.now());

  const [proposals, setProposals] = useState<ThumbnailIdeaJob[]>([]);
  /** Which proposed concepts are ticked for queueing. */
  const [chosenIdeas, setChosenIdeas] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const [rows, props] = await Promise.all([
        api.listThumbnailJobs(projectId),
        api.listThumbnailProposals(projectId),
      ]);
      setJobs(rows);
      setProposals(props);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll only while something is still rendering — a finished pool is static.
  const anyActive = jobs.some((j) => ACTIVE.has(j.status))
                 || proposals.some((p) => ACTIVE.has(p.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, refresh]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const chosen = useMemo(() => jobs.find((j) => j.chosenFilename), [jobs]);

  // Reopen where the wording was left, instead of resetting it.
  useEffect(() => {
    if (chosen?.captionSpec) setCaption({ ...DEFAULT_CAPTION, ...chosen.captionSpec });
    if (chosen?.chosenFilename) setPicked({ jobId: chosen.id, filename: chosen.chosenFilename });
  }, [chosen?.id, chosen?.chosenFilename]);

  const totalCandidates = jobs.reduce((n, j) => n + (j.candidates?.length ?? 0), 0);
  const latestProposal = proposals[0];

  // EVERY concept the model has ever proposed for this project, newest round
  // first. Rounds accumulate: asking for more never rewrites or hides what came
  // before, and the only thing that removes a concept is the ✕ next to it.
  const proposedIdeas: Array<{ jobId: string; index: number; idea: ThumbnailIdeaInput }> =
    proposals.flatMap((p) => (p.result ?? []).map((idea, index) => ({ jobId: p.id, index, idea })));

  const propose = async () => {
    setBusy(true); setError(null);
    try { await api.proposeThumbnailIdeas(projectId, 6); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const queueChosen = async () => {
    const picks = proposedIdeas.filter((p) => chosenIdeas[`${p.jobId}:${p.index}`]);
    if (picks.length === 0) { setError('Отметь хотя бы одну идею'); return; }
    setBusy(true); setError(null);
    try {
      await api.enqueueThumbnailIdeas(projectId, picks.map((p) => ({ ...p.idea, batchSize: 5 })));
      setChosenIdeas({});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const dropProposedIdea = async (jobId: string, index: number) => {
    setBusy(true); setError(null);
    try { await api.deleteProposedIdea(projectId, jobId, index); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const applyCaption = async () => {
    if (!picked) return;
    const lines = (caption.lines ?? []).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setError('Впиши текст подписи'); return; }
    setBusy(true); setError(null);
    try {
      await api.chooseThumbnail(projectId, { ...picked, captionSpec: { ...caption, lines } });
      setCoverBust(Date.now());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const cancelJob = async (jobId: string) => {
    setBusy(true);
    try { await api.cancelThumbnailJob(projectId, jobId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addMore = async (jobId: string) => {
    setBusy(true); setError(null);
    try { await api.addMoreThumbnails(projectId, jobId, 5); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteJob = async (job: ThumbnailJob) => {
    if (!confirm(`Удалить идею «${job.idea || 'без названия'}» и все её картинки (${job.candidates?.length ?? 0})?`)) return;
    setBusy(true); setError(null);
    try { await api.deleteThumbnailJob(projectId, job.id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteCandidate = async (jobId: string, filename: string) => {
    setBusy(true); setError(null);
    try {
      await api.deleteThumbnailCandidate(projectId, jobId, filename);
      if (picked?.jobId === jobId && picked.filename === filename) setPicked(null);
      if (lightbox !== 'cover' && lightbox?.filename === filename) setLightbox(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const setLine = (i: number, value: string) => {
    const lines = [...(caption.lines ?? [''])];
    lines[i] = value;
    setCaption({ ...caption, lines });
  };

  if (loading) return <div className="p-6 text-sm text-zinc-500">Загрузка…</div>;

  return (
    <div className="p-6 flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-zinc-100">Обложка</h1>
        <p className="mt-1 text-xs text-zinc-500 max-w-3xl">
          Арт рендерится <b>без единой буквы</b> — подпись накладывается отдельно, из файла шрифта,
          поэтому её можно переписывать сколько угодно раз без GPU.
          {' '}Концепций от модели: {proposedIdeas.length}, отправлено в рендер: {jobs.length},
          готовых картинок: {totalCandidates}.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</div>
      )}

      {/* ── Идеи от локальной модели ───────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <b className="text-sm text-zinc-100">Идеи от модели</b>
          <span className="text-[11px] text-zinc-500">
            {latestProposal ? (STATUS_RU[latestProposal.status] ?? latestProposal.status) : 'ещё не запускалось'}
          </span>
          <button type="button" onClick={() => void propose()} disabled={busy}
                  className="ml-auto rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-40">
            Предложить 6 идей
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Модель читает сценарий и сама придумывает концепции. Идёт через очередь — Ollama нужна вся видеокарта,
          поэтому задание ждёт, пока освободится слот, и не убивает текущий рендер.
        </p>

        {latestProposal?.errorMessage && (
          <div className="mt-2 break-all font-mono text-[11px] text-red-300">{latestProposal.errorMessage}</div>
        )}

        {proposedIdeas.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {proposedIdeas.map(({ jobId, index, idea }) => {
              const key = `${jobId}:${index}`;
              return (
                <div key={key} className="flex gap-2 rounded border border-zinc-800 bg-zinc-950 p-2">
                  <label className="flex flex-1 cursor-pointer gap-2">
                    <input type="checkbox" className="mt-0.5" checked={!!chosenIdeas[key]}
                           onChange={(e) => setChosenIdeas({ ...chosenIdeas, [key]: e.target.checked })} />
                    <span className="flex-1">
                      <span className="text-xs text-zinc-100">{idea.idea || `идея ${index + 1}`}</span>
                      {idea.captionSpec?.lines && (
                        <span className="ml-2 text-[11px] text-amber-300">
                          «{idea.captionSpec.lines.join(' / ')}»
                        </span>
                      )}
                      <span className="ml-2 text-[11px] text-sky-300">
                        {idea.refProfileCodes?.length ? idea.refProfileCodes.join(' + ') : 'без лиц'}
                      </span>
                      {idea.refReason && (
                        <span className="ml-2 text-[11px] text-zinc-600">— {idea.refReason}</span>
                      )}
                      <span className="mt-1 block text-[11px] text-zinc-500">{idea.prompt}</span>
                    </span>
                  </label>
                  <button type="button" onClick={() => void dropProposedIdea(jobId, index)} disabled={busy}
                          title="Удалить эту концепцию"
                          className="h-fit rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-950/60">
                    ✕
                  </button>
                </div>
              );
            })}
            <button type="button" onClick={() => void queueChosen()} disabled={busy}
                    className="self-start rounded bg-purple-700 px-3 py-1.5 text-xs text-white hover:bg-purple-600 disabled:opacity-40">
              Отправить отмеченные в рендер
            </button>
          </div>
        )}
      </section>

      {jobs.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-500">
          В рендер пока ничего не отправлено — отметь концепции выше и нажми «Отправить отмеченные в рендер».
        </div>
      )}

      {/* ── Пул кандидатов ─────────────────────────────────────────────── */}
      {jobs.map((job) => (
        <section key={job.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <b className="text-sm text-zinc-100">{job.idea || '(без названия)'}</b>
            <span className="text-[11px] text-zinc-500">{STATUS_RU[job.status] ?? job.status}</span>
            <span className="text-[11px] text-zinc-500">
              {job.refProfileCodes?.length
                ? <>лица: {job.refProfileCodes.join(' + ')}{job.referenceLatents === false && ' (только семантика)'}</>
                : 'без лиц'}
            </span>
            <span className="ml-auto flex gap-2">
              {ACTIVE.has(job.status) ? (
                <button type="button" onClick={() => void cancelJob(job.id)} disabled={busy}
                        className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700">
                  отменить
                </button>
              ) : (
                <button type="button" onClick={() => void addMore(job.id)} disabled={busy}
                        className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                        title="Дорендерить ещё 5 картинок по этому же промпту">
                  + ещё 5
                </button>
              )}
              <button type="button" onClick={() => void deleteJob(job)} disabled={busy}
                      className="rounded bg-red-900/70 px-2 py-1 text-[11px] text-red-100 hover:bg-red-800"
                      title="Удалить промпт и все его картинки">
                удалить идею
              </button>
            </span>
          </div>

          {job.errorMessage && (
            <div className="mb-2 break-all font-mono text-[11px] text-red-300">{job.errorMessage}</div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(job.candidates ?? []).map((filename) => {
              const isPicked = picked?.jobId === job.id && picked.filename === filename;
              return (
                <div key={filename}
                     className={`flex flex-col overflow-hidden rounded-lg border bg-zinc-950 ${
                       isPicked ? 'border-purple-500 ring-2 ring-purple-500/40' : 'border-zinc-800'}`}>
                  <button type="button" onClick={() => setLightbox({ jobId: job.id, filename })}
                          className="relative block aspect-video cursor-zoom-in" title="Открыть полноразмер">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={api.thumbnailCandidateUrl(projectId, job.id, filename)} alt={filename}
                         className="h-full w-full object-cover" loading="lazy" />
                    {job.chosenFilename === filename && (
                      <span className="absolute right-1.5 top-1.5 rounded bg-purple-700/90 px-1.5 py-0.5 text-[11px] text-purple-100">
                        ✓ обложка
                      </span>
                    )}
                  </button>
                  <div className="flex border-t border-zinc-800">
                    <button type="button" onClick={() => setPicked({ jobId: job.id, filename })}
                            className="flex-1 px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800/60">
                      {isPicked ? '● выбрано' : 'выбрать'}
                    </button>
                    <button type="button" onClick={() => void deleteCandidate(job.id, filename)} disabled={busy}
                            title="Удалить эту картинку"
                            className="border-l border-zinc-800 px-2.5 py-1.5 text-[11px] text-red-300 hover:bg-red-950/60">
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
            {ACTIVE.has(job.status) && (
              <div className="grid aspect-video place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-600">
                {STATUS_RU[job.status]}…
              </div>
            )}
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-zinc-600">промпт</summary>
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-zinc-500">{job.prompt}</p>
          </details>
        </section>
      ))}

      {/* ── Подпись ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <b className="text-sm text-zinc-100">Подпись</b>
        <p className="mb-3 mt-1 text-[11px] text-zinc-500">
          {picked
            ? <>Ляжет на <code className="text-zinc-400">{picked.filename}</code>.</>
            : 'Сначала выбери кандидата выше.'}
        </p>

        <div className="flex max-w-xl flex-col gap-2">
          <input className={input} value={caption.lines?.[0] ?? ''} onChange={(e) => setLine(0, e.target.value)}
                 placeholder="ПЕРВАЯ СТРОКА" />
          <input className={input} value={caption.lines?.[1] ?? ''} onChange={(e) => setLine(1, e.target.value)}
                 placeholder="вторая строка (необязательно)" />

          <div className="flex flex-wrap items-center gap-2">
            <input className={`${input} min-w-[160px] flex-1`} value={caption.accent_word ?? ''}
                   onChange={(e) => setCaption({ ...caption, accent_word: e.target.value })}
                   placeholder="акцентное слово" />
            <input type="color" value={caption.accent_color ?? '#E01B24'}
                   onChange={(e) => setCaption({ ...caption, accent_color: e.target.value })}
                   className="h-9 w-11 rounded border border-zinc-800 bg-zinc-950 p-1" />
            <select className={input} value={caption.position ?? 'bottom'}
                    onChange={(e) => setCaption({ ...caption, position: e.target.value as CaptionSpec['position'] })}>
              <option value="bottom">низ</option>
              <option value="center">центр</option>
              <option value="top">верх</option>
            </select>
            <select className={input} value={caption.align ?? 'center'}
                    onChange={(e) => setCaption({ ...caption, align: e.target.value as CaptionSpec['align'] })}>
              <option value="center">по центру</option>
              <option value="left">влево</option>
              <option value="right">вправо</option>
            </select>
          </div>

          <button type="button" onClick={() => void applyCaption()} disabled={!picked || busy}
                  className="self-start rounded bg-purple-700 px-4 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-40">
            {busy ? 'Рисую…' : 'Наложить текст'}
          </button>
        </div>
      </section>

      {/* ── Готовая обложка ────────────────────────────────────────────── */}
      {chosen?.outputPath && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <b className="text-sm text-zinc-100">Готовая обложка</b>
          <p className="mb-3 mt-1 break-all font-mono text-[11px] text-zinc-500">
            {chosen.outputPath} — уже под лимитом YouTube API в 2МБ.
          </p>
          <button type="button" onClick={() => setLightbox('cover')} className="block cursor-zoom-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={api.thumbnailCoverUrl(projectId, coverBust)} alt="обложка"
                 className="w-full max-w-2xl rounded border border-zinc-800" />
          </button>
        </section>
      )}

      {/* ── Лайтбокс ───────────────────────────────────────────────────── */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
             className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="absolute right-4 top-4 flex gap-2">
            {lightbox !== 'cover' && (
              <button type="button"
                      onClick={(e) => { e.stopPropagation(); setPicked(lightbox); setLightbox(null); }}
                      className="rounded bg-purple-700/90 px-3 py-1 text-xs text-white hover:bg-purple-600">
                ✓ выбрать для подписи
              </button>
            )}
            <button type="button" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                    className="rounded bg-zinc-800/80 px-3 py-1 text-xs text-white hover:bg-zinc-700">
              ESC
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox === 'cover'
              ? api.thumbnailCoverUrl(projectId, coverBust)
              : api.thumbnailCandidateUrl(projectId, lightbox.jobId, lightbox.filename)}
            alt="кандидат"
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
