'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AnchorCandidatesResponse, AnchorRenderJob, AnchorValidationJob, BaseProfileInfo, ProfileStyleReadiness } from '../lib/api';
import { AnchorPanelView } from './AnchorPanelView';

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

const POLL_MS = 3000;

export function CharacterAnchorPanel({ profileId }: { profileId: string }) {
  const [readiness,    setReadiness]    = useState<ProfileStyleReadiness | null>(null);
  const [jobs,         setJobs]         = useState<AnchorRenderJob[] | null>(null);
  const [valJobs,      setValJobs]      = useState<AnchorValidationJob[] | null>(null);
  const [cands,        setCands]        = useState<AnchorCandidatesResponse | null>(null);
  const [baseInfo,     setBaseInfo]     = useState<BaseProfileInfo | null>(null);
  const [suggestDraft, setSuggestDraft] = useState<string | null>(null);
  const [busy,         setBusy]         = useState<'enqueue' | 'upload' | 'delete' | 'validate' | 'apply' | 'select' | 'base' | 'approve' | null>(null);
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
      const [r, j, v, c, b] = await Promise.all([
        api.profileStyleReadiness(profileId),
        api.listAnchorJobs(profileId),
        api.listAnchorValidationJobs(profileId),
        // 400 for unattached (library-only) profiles — a missing gallery must
        // not poison the whole panel.
        api.listAnchorCandidates(profileId).catch(() => null),
        api.getBaseProfile(profileId).catch(() => null),
      ]);
      setReadiness(r);
      setJobs(j);
      setValJobs(v);
      setCands(c);
      setBaseInfo(b);
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

  /** Sign off on the anchor the validator installed. Also what releases the
   *  inheritance chain — a derived state is a Qwen edit of THIS portrait. */
  const handleApprove = () => wrap('approve', async () => {
    await api.approveAnchor(profileId);
  })();

  /** Anchor inheritance: pick which sibling profile this one derives from. */
  const handleSetBase = (baseProfileId: string | null) => wrap('base', async () => {
    const b = await api.setBaseProfile(profileId, baseProfileId);
    setBaseInfo(b);
  })();

  const candidates = cands?.candidates ?? [];

  return (
    <AnchorPanelView
      title="Anchor portrait (cartoon identity)"
      hint={
        <>
          Identity лочится на одном portrait-anchor. Рендер ДОБАВЛЯЕТ кандидатов в пул (старые не стираются),
          нейронка проверяет только новые (анти-аниме QC) и ставит лучший только если якорь ещё не установлен —
          финальный выбор всегда за тобой: любой кандидат из галереи можно сделать якорем.
        </>
      }
      aspect="portrait"
      anchorUrl={primaryAnchor ? api.anchorRawUrl(profileId, anchorBust) : null}
      anchorFilename={primaryAnchor?.split(/[\/]/).pop() ?? null}
      anchorIsExternal={cands?.anchorIsExternal}
      candidateUrl={(f) => api.anchorCandidateRawUrl(profileId, f)}
      candidates={candidates}
      lastJob={lastJob}
      activeJob={activeJob}
      busy={busy}
      error={error}
      onGenerate={handleEnqueue}
      onUpload={(f) => void handleUpload(f)}
      onDelete={() => void handleDelete()}
      onSelect={(f) => void handleSelect(f)}
      approvedAt={readiness?.anchorApprovedAt ?? null}
      onApprove={() => void handleApprove()}
      generateIdleLabel="Generate via prompt (queue)"
      generateRegenLabel="Regenerate via prompt (queue)"
      // A profile that inherits its face has no donor until the base anchor is
      // installed — the API rejects such an enqueue, so don't offer the click.
      renderBlockedReason={
        baseInfo && baseInfo.baseProfileId !== null && !baseInfo.baseAnchorReady
          ? `Наследует лицо от ${baseInfo.baseProfileCode ?? 'базового профиля'} — сначала утвердите его якорь, `
            + 'этот встанет в очередь автоматически'
          : null
      }
      validation={{
        active:         valActive,
        chosenFilename: cands?.validation?.chosenFilename ?? null,
        ran:            Boolean(cands?.validation),
        onRevalidate:   () => void handleRevalidate(),
      }}
      footer={
        <>
          {baseInfo && baseInfo.options.length > 0 && (
            <div className="mt-3 bg-zinc-950 border border-zinc-800 rounded p-2 text-xs">
              <div className="text-zinc-500 mb-1">
                Наследование лица: рендерить якорь как «тот же человек» от якоря другого профиля
                (старение/изменение состояния вместо генерации с нуля)
              </div>
              <select
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs"
                disabled={busy !== null}
                value={baseInfo.baseProfileId ?? ''}
                onChange={(e) => void handleSetBase(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">— независимый рендер (text-to-image) —</option>
                {baseInfo.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    от {o.profileCode}{o.ageLabel ? ` (${o.ageLabel})` : ''}{o.anchorExists ? ' — якорь готов' : ' — якоря ещё нет'}
                  </option>
                ))}
              </select>
              {baseInfo.baseProfileId !== null && (
                <div className="text-zinc-600 mt-1">
                  Рендер этого якоря встанет в очередь автоматически в момент апрува якоря базового профиля
                  (выбор кандидата или загрузка файла). Автоматики внутри очереди нет.
                </div>
              )}
            </div>
          )}
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
          {readiness && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                Per-style readiness ({Object.keys(readiness.styles).length} styles)
              </summary>
              {/* overflow-x-auto: 4 колонки диагностики шире телефона, а
                  колонка страницы горизонтальный оверфлоу режет без скролла */}
              <div className="overflow-x-auto">
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
                  {Object.entries(readiness.styles).map(([id, st]) => (
                    <tr key={id} className="border-t border-zinc-800">
                      <td className="py-1">{id}</td>
                      <td className="py-1 text-zinc-400">{st.identityStack}</td>
                      <td className="py-1">
                        {st.ready ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="py-1 text-zinc-400 truncate max-w-[280px]" title={st.assets.loraPath ?? st.assets.anchorPath ?? ''}>
                        {st.assets.loraPath ?? st.assets.anchorPath ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          )}
        </>
      }
    />
  );
}
