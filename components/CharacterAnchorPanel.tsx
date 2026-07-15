'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AnchorCandidate, AnchorCandidatesResponse, AnchorRenderJob, AnchorValidationJob, ProfileStyleReadiness } from '../lib/api';

/**
 * Anchor portrait panel for a character profile.
 *
 * Identity-stack for cartoon-style projects: IP-Adapter on a single anchor
 * portrait PNG. The anchor render produces a best-of-N batch of candidate
 * portraits; the vision validator (Ollama) scores each one (anti-anime QC)
 * and auto-installs its pick — but the FINAL SAY is the user's:
 *
 *   - the candidates gallery shows EVERY portrait from the last render,
 *     each with the model's verdict (score / issues / severe);
 *   - «🤖» marks the validator's automatic pick, a purple ring marks the
 *     currently installed anchor;
 *   - «Сделать якорем» on any candidate overrides the automatic choice.
 *
 * Also supports uploading an external PNG/JPG (shows as «внешний файл» since
 * it matches no candidate). Auto-hides for photoreal-only characters.
 */

const STATUS_COLOR: Record<AnchorRenderJob['status'], string> = {
  pending:   'bg-zinc-700 text-zinc-200',
  running:   'bg-amber-700 text-amber-100',
  completed: 'bg-emerald-700 text-emerald-100',
  failed:    'bg-red-800   text-red-100',
  cancelled: 'bg-zinc-700  text-zinc-300',
};

const STATUS_LABEL: Record<AnchorRenderJob['status'], string> = {
  pending:   'в очереди',
  running:   'рендерится',
  completed: 'готов',
  failed:    'ошибка',
  cancelled: 'отменён',
};

const POLL_MS = 3000;

function scoreBadgeCls(c: AnchorCandidate): string {
  const v = c.verdict;
  if (!v || v.error)       return 'bg-zinc-700 text-zinc-400';
  if (v.severe)            return 'bg-red-800 text-red-100';
  if (v.score >= 75)       return 'bg-emerald-800 text-emerald-100';
  if (v.score >= 50)       return 'bg-amber-700 text-amber-50';
  return 'bg-red-800 text-red-100';
}

export function CharacterAnchorPanel({ profileId }: { profileId: string }) {
  const [readiness,    setReadiness]    = useState<ProfileStyleReadiness | null>(null);
  const [jobs,         setJobs]         = useState<AnchorRenderJob[] | null>(null);
  const [valJobs,      setValJobs]      = useState<AnchorValidationJob[] | null>(null);
  const [cands,        setCands]        = useState<AnchorCandidatesResponse | null>(null);
  const [suggestDraft, setSuggestDraft] = useState<string | null>(null);
  const [busy,         setBusy]         = useState<'enqueue' | 'upload' | 'delete' | 'validate' | 'apply' | 'select' | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  /** Lightbox: 'anchor' = installed anchor.png, otherwise a candidate filename. */
  const [lightbox,     setLightbox]     = useState<'anchor' | string | null>(null);
  /** Cache-buster for the installed-anchor <img>; bumped on render/upload/select. */
  const [anchorBust,   setAnchorBust]   = useState(Date.now());
  const prevCompleted = useRef<string | null>(null);
  const prevValChosen = useRef<string | null>(null);
  const pollTimer     = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const loadAll = useCallback(async () => {
    try {
      const [r, j, v, c] = await Promise.all([
        api.profileStyleReadiness(profileId),
        api.listAnchorJobs(profileId),
        api.listAnchorValidationJobs(profileId),
        // 400 for unattached (library-only) profiles — a missing gallery must
        // not poison the whole panel.
        api.listAnchorCandidates(profileId).catch(() => null),
      ]);
      setReadiness(r);
      setJobs(j);
      setValJobs(v);
      setCands(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  useEffect(() => {
    void loadAll();
    pollTimer.current = setInterval(() => { void loadAll(); }, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [loadAll]);

  // New render finished → refetch the installed-anchor image.
  useEffect(() => {
    const lastCompleted = jobs?.find((j) => j.status === 'completed');
    if (lastCompleted && lastCompleted.id !== prevCompleted.current) {
      prevCompleted.current = lastCompleted.id;
      setAnchorBust(Date.now());
    }
  }, [jobs]);

  // Validation installed its pick → refetch too.
  useEffect(() => {
    const done = valJobs?.find((v) => v.status === 'completed' && v.chosenFilename);
    if (done && done.id !== prevValChosen.current) {
      prevValChosen.current = done.id;
      setAnchorBust(Date.now());
    }
  }, [valJobs]);

  const hasCartoonProject = (readiness?.attachedProjects ?? []).some(
    (p) => p.visualStyle !== 'photoreal_cinematic',
  );
  const isLibrary = (readiness?.attachedProjects ?? []).length === 0;
  if (readiness && !hasCartoonProject && !isLibrary) return null;

  const cartoonStyles = readiness
    ? Object.entries(readiness.styles).filter(([, s]) => s.identityStack !== 'lora_face_lock')
    : [];
  const primaryAnchor = cartoonStyles
    .map(([, s]) => s.assets.anchorPath)
    .find((p): p is string => p !== null) ?? null;

  const activeJob = jobs?.find((j) => j.status === 'pending' || j.status === 'running') ?? null;
  const lastJob   = jobs?.[0] ?? null;
  const lastVal   = valJobs?.find((v) => v.status === 'completed') ?? valJobs?.[0] ?? null;
  const valActive = cands?.validationActive
    ?? (valJobs?.some((v) => v.status === 'pending' || v.status === 'running') ?? false);
  const suggested = cands?.validation?.suggestedPrompt ?? lastVal?.suggestedPrompt ?? null;

  const wrap = (tag: NonNullable<typeof busy>, fn: () => Promise<unknown>) => async () => {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleEnqueue = wrap('enqueue', () => api.generateAnchor(profileId));

  const handleUpload = (file: File) => wrap('upload', async () => {
    await api.uploadAnchor(profileId, file);
    setAnchorBust(Date.now());
  })();

  const handleDelete = async () => {
    if (!confirm('Удалить anchor portrait? После удаления можно сгенерировать заново или выбрать кандидата.')) return;
    await wrap('delete', async () => {
      await api.deleteAnchor(profileId);
      setAnchorBust(Date.now());
    })();
  };

  const handleRevalidate = wrap('validate', async () => {
    const r = await api.validateAnchor(profileId);
    if (!r.queued && r.reason) setError(r.reason);
  });

  /** The user's manual pick: install this candidate as the anchor. */
  const handleSelect = (filename: string) => wrap('select', async () => {
    await api.selectAnchorCandidate(profileId, filename);
    setAnchorBust(Date.now());
  })();

  const handleApplySuggested = (prompt: string, rerender: boolean) => wrap('apply', async () => {
    await api.applySuggestedAnchorPrompt(profileId, prompt.trim(), rerender);
    setSuggestDraft(null);
  })();

  const candidates = cands?.candidates ?? [];

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">
          Anchor portrait (cartoon identity)
        </h2>
        {readiness && cartoonStyles.length > 0 && (
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${
              primaryAnchor
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            {primaryAnchor ? 'anchor ready' : 'no anchor yet'}
          </span>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Identity лочится через IP-Adapter на одном portrait-anchor. Рендер делает несколько кандидатов,
        нейронка проверяет каждый (анти-аниме QC) и ставит лучший — но финальный выбор за тобой: любой
        кандидат из галереи можно сделать якорем.
      </p>

      <div className="flex gap-4">
        {/* Installed anchor preview */}
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={() => primaryAnchor && setLightbox('anchor')}
            disabled={!primaryAnchor}
            className="w-40 h-56 bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex items-center justify-center hover:border-purple-600 disabled:hover:border-zinc-800 disabled:cursor-default cursor-zoom-in"
            title={primaryAnchor ? 'Открыть полноразмер' : 'Якоря ещё нет'}
          >
            {primaryAnchor ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={api.anchorRawUrl(profileId, anchorBust)}
                alt="anchor portrait"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-zinc-600 text-sm">no preview</div>
            )}
          </button>
          <div className="mt-1 text-center text-[11px] text-zinc-500">
            текущий якорь
            {cands?.anchorIsExternal && primaryAnchor && (
              <span className="block text-amber-400">внешний файл (не из кандидатов)</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 flex-1">
          <button
            type="button"
            onClick={handleEnqueue}
            disabled={busy !== null || !!activeJob}
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded text-sm"
            title={activeJob ? 'Job is already in the queue' : ''}
          >
            {activeJob
              ? `In queue (${activeJob.status})`
              : busy === 'enqueue'
                ? 'Enqueuing…'
                : primaryAnchor
                  ? 'Regenerate via prompt (queue)'
                  : 'Generate via prompt (queue)'}
          </button>

          <label className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-100 px-4 py-2 rounded text-sm text-center cursor-pointer block">
            {busy === 'upload' ? 'Uploading…' : primaryAnchor ? 'Replace from file (PNG/JPG)' : 'Upload from file (PNG/JPG)'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
          </label>

          {primaryAnchor && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== null || !!activeJob}
              className="text-zinc-400 hover:text-red-400 disabled:opacity-50 border border-zinc-800 rounded px-4 py-2 text-sm"
              title="Delete current anchor (you can regenerate after)"
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete anchor'}
            </button>
          )}

          {error && (
            <div className="bg-red-900/40 border border-red-800 rounded p-2 text-red-200 text-xs font-mono break-all">
              {error}
            </div>
          )}

          {lastJob && (
            <div className="text-xs text-zinc-500 mt-1">
              <span
                className={`inline-block px-2 py-0.5 rounded mr-2 ${STATUS_COLOR[lastJob.status]}`}
              >
                {STATUS_LABEL[lastJob.status]}
              </span>
              <span className="text-zinc-500">job {lastJob.id.slice(0, 8)}</span>
              {lastJob.errorMessage && (
                <div className="text-red-300 mt-1 font-mono break-all">{lastJob.errorMessage}</div>
              )}
            </div>
          )}

          {/* Validation status line */}
          <div className="mt-2 border-t border-zinc-800 pt-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">
              Проверка ИИ (анти-аниме + выбор лучшего)
            </span>
            <div className="flex items-center gap-2">
              {valActive && <span className="text-[11px] text-amber-400">проверяется…</span>}
              {!valActive && cands?.validation && (
                <span className="text-[11px] text-zinc-500">
                  {cands.validation.chosenFilename
                    ? <>🤖 выбор ИИ: <span className="text-emerald-400">{cands.validation.chosenFilename}</span></>
                    : <span className="text-amber-400">⛔ годного портрета ИИ не нашёл</span>}
                </span>
              )}
              <button
                type="button"
                onClick={handleRevalidate}
                disabled={busy !== null || valActive}
                className="text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-2 py-0.5 rounded"
              >
                🔁 перепроверить
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Candidates gallery — every portrait from the last render, with the
             model's verdicts; the user installs any of them as the anchor ── */}
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
          Кандидаты последнего рендера ({candidates.length})
        </div>
        {candidates.length === 0 ? (
          <div className="text-xs text-zinc-600">
            Кандидатов нет — запусти «Generate via prompt», рендер сложит сюда все варианты.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {candidates.map((c) => (
              <div
                key={c.filename}
                className={`rounded-lg overflow-hidden border bg-zinc-950 flex flex-col ${
                  c.selected ? 'border-purple-500 ring-2 ring-purple-500/40' : 'border-zinc-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(c.filename)}
                  className="relative block aspect-[3/4] cursor-zoom-in"
                  title="Открыть полноразмер"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.anchorCandidateRawUrl(profileId, c.filename)}
                    alt={c.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-1.5 left-1.5 flex gap-1">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${scoreBadgeCls(c)}`}>
                      {c.verdict ? (c.verdict.error ? 'err' : c.verdict.score) : '—'}
                    </span>
                    {c.verdict?.severe && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-100">⛔</span>
                    )}
                  </div>
                  <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
                    {c.chosenByAI && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/80 text-emerald-200" title="Автоматический выбор нейронки">
                        🤖 ИИ
                      </span>
                    )}
                    {c.selected && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-700/90 text-purple-100" title="Установлен как якорь">
                        ✓ якорь
                      </span>
                    )}
                  </div>
                </button>
                <div className="p-2 flex flex-col gap-1.5 flex-1">
                  {/* Verdict of the vision model for THIS candidate */}
                  {c.verdict ? (
                    c.verdict.error ? (
                      <div className="text-[11px] text-zinc-500 font-mono break-all" title={c.verdict.error}>
                        ошибка проверки
                      </div>
                    ) : c.verdict.issues.length > 0 ? (
                      <div className="text-[11px] text-zinc-400 leading-snug" title={c.verdict.issues.join('; ')}>
                        {c.verdict.issues.slice(0, 2).join('; ')}
                        {c.verdict.issues.length > 2 && ' …'}
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-500">без замечаний</div>
                    )
                  ) : (
                    <div className="text-[11px] text-zinc-600">{valActive ? 'проверяется…' : 'не проверялся'}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelect(c.filename)}
                    disabled={busy !== null || c.selected}
                    className={`mt-auto text-[11px] px-2 py-1 rounded ${
                      c.selected
                        ? 'bg-purple-900/40 text-purple-300 cursor-default'
                        : 'bg-zinc-800 hover:bg-purple-700 text-zinc-100'
                    }`}
                  >
                    {c.selected ? 'выбран якорем' : busy === 'select' ? '…' : 'сделать якорем'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested promptBase when nothing passed QC */}
      {!valActive && suggested && cands?.validation && !cands.validation.chosenFilename && (
        <div className="mt-3 bg-zinc-950 border border-zinc-800 rounded p-2 text-xs">
          <div className="text-zinc-500 mb-1">Предложенный promptBase (правь и применяй):</div>
          <textarea
            className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-zinc-200 text-xs font-mono"
            rows={4}
            value={suggestDraft ?? suggested}
            onChange={(e) => setSuggestDraft(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleApplySuggested(suggestDraft ?? suggested, false)}
              className="text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-2 py-1 rounded"
            >
              Применить
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleApplySuggested(suggestDraft ?? suggested, true)}
              className="text-[11px] bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white px-2 py-1 rounded"
            >
              Применить и перерендерить
            </button>
          </div>
        </div>
      )}

      {/* Lightbox — installed anchor or one candidate, with select action */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
            <div className="text-zinc-400 text-xs font-mono break-all">
              {lightbox === 'anchor'
                ? (primaryAnchor?.split(/[\\/]/).pop() ?? 'anchor')
                : lightbox}
            </div>
            <div className="flex gap-2">
              {lightbox === 'anchor' ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete().then(() => setLightbox(null));
                  }}
                  className="text-xs bg-red-700/80 hover:bg-red-600 text-white px-3 py-1 rounded"
                >
                  ✕ удалить
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSelect(lightbox).then(() => setLightbox(null));
                  }}
                  className="text-xs bg-purple-700/90 hover:bg-purple-600 text-white px-3 py-1 rounded"
                >
                  ✓ сделать якорем
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                className="text-xs bg-zinc-800/80 hover:bg-zinc-700 text-white px-3 py-1 rounded"
              >
                ESC
              </button>
            </div>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox === 'anchor'
              ? api.anchorRawUrl(profileId, anchorBust)
              : api.anchorCandidateRawUrl(profileId, lightbox)}
            alt="anchor portrait"
            className="max-w-[95vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Style readiness table */}
      {readiness && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            Per-style readiness ({Object.keys(readiness.styles).length} styles)
          </summary>
          <table className="mt-2 w-full font-mono text-[11px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left py-1">Style</th>
                <th className="text-left py-1">Identity</th>
                <th className="text-left py-1">Ready?</th>
                <th className="text-left py-1">Asset</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(readiness.styles).map(([id, s]) => (
                <tr key={id} className="border-t border-zinc-800">
                  <td className="py-1">{id}</td>
                  <td className="py-1 text-zinc-400">{s.identityStack}</td>
                  <td className="py-1">
                    {s.ready ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="py-1 text-zinc-400 truncate max-w-[280px]" title={s.assets.loraPath ?? s.assets.anchorPath ?? ''}>
                    {s.assets.loraPath ?? s.assets.anchorPath ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
