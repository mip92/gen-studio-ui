'use client';

import { ReactNode, useEffect, useState } from 'react';

/**
 * The anchor panel, once, for both entities that have one.
 *
 * Characters and props do the SAME work — render a best-of-N batch, review the
 * candidates, install one, upload your own, delete, regenerate — so they get the
 * same panel and differ only by the props passed in. This file owns all of the
 * markup; `CharacterAnchorPanel` and `PropAnchorPanel` own only the fetching and
 * the per-entity wording.
 *
 * Entity-specific bits are optional props rather than branches:
 *   - `validation`  — the vision-QC row and the per-candidate verdicts. Present
 *                     for characters (anti-anime portrait QC), absent for props.
 *   - `controls`    — rendered above the generate button (props put the engine
 *                     picker there).
 *   - `footer`      — anything below the gallery (characters put the suggested
 *                     promptBase and the readiness table there).
 *   - `aspect`      — portraits are 3/4, object studies are 16/9.
 */

export type AnchorJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

const STATUS_COLOR: Record<AnchorJobStatus, string> = {
  pending:   'bg-zinc-700 text-zinc-200',
  running:   'bg-amber-700 text-amber-100',
  completed: 'bg-emerald-700 text-emerald-100',
  failed:    'bg-red-800   text-red-100',
  cancelled: 'bg-zinc-700  text-zinc-300',
};

const STATUS_LABEL: Record<AnchorJobStatus, string> = {
  pending:   'в очереди',
  running:   'рендерится',
  completed: 'готов',
  failed:    'ошибка',
  cancelled: 'отменён',
};

export interface AnchorPanelVerdict {
  score:   number;
  issues:  string[];
  /** optional: the character verdict type leaves it undefined when unscored */
  severe?: boolean;
  error?:  string | null;
}

export interface AnchorPanelCandidate {
  filename:    string;
  /** currently installed as the anchor */
  selected:    boolean;
  /** the validator's own pick */
  chosenByAI?: boolean;
  verdict?:    AnchorPanelVerdict | null;
}

export interface AnchorPanelViewProps {
  title:   string;
  hint:    ReactNode;
  /** null when nothing is installed yet */
  anchorUrl:      string | null;
  anchorFilename?: string | null;
  /** installed anchor matches no candidate (uploaded / promoted from a render) */
  anchorIsExternal?: boolean;
  candidateUrl: (filename: string) => string;
  candidates:   AnchorPanelCandidate[];
  aspect:       'portrait' | 'landscape';

  lastJob?:   { id: string; status: AnchorJobStatus; errorMessage?: string | null; note?: string | null } | null;
  activeJob?: { status: AnchorJobStatus } | null;

  busy:  string | null;
  error: string | null;

  onGenerate: () => void;
  onUpload:   (file: File) => void;
  onDelete:   () => void;
  onSelect:   (filename: string) => void;
  /**
   * Approval. The render pipelines install a candidate BY THEMSELVES the moment
   * a batch finishes — the vision validator's pick for characters, the first
   * file for props — so an installed anchor is not evidence anyone reviewed it.
   * This is where that review happens: nothing depending on the anchor renders
   * until `approvedAt` is set. Picking a candidate or uploading a file approves
   * implicitly (the user demonstrably chose that image), so the button only
   * matters for the machine's own pick.
   */
  approvedAt?: string | null;
  onApprove?:  () => void;

  generateIdleLabel:  string;
  generateRegenLabel: string;

  /**
   * Why a render is impossible right now — set it and the generate button is
   * disabled with this text underneath. Live case: a profile that inherits its
   * face cannot render before the base profile's anchor is approved (it IS the
   * donor image), and the API rejects such an enqueue anyway. Better to show the
   * reason than to let the click fail.
   */
  renderBlockedReason?: string | null;

  /** Characters only: the vision-QC status row. Omit to hide it entirely. */
  validation?: {
    active:          boolean;
    chosenFilename?: string | null;
    /** null when the validator ran and rejected everything */
    ran:             boolean;
    onRevalidate:    () => void;
  } | null;

  controls?: ReactNode;
  footer?:   ReactNode;
}

function scoreBadgeCls(v?: AnchorPanelVerdict | null): string {
  if (!v || v.error)  return 'bg-zinc-700 text-zinc-400';
  if (v.severe)       return 'bg-red-800 text-red-100';
  if (v.score >= 75)  return 'bg-emerald-800 text-emerald-100';
  if (v.score >= 50)  return 'bg-amber-700 text-amber-50';
  return 'bg-red-800 text-red-100';
}

export function AnchorPanelView(p: AnchorPanelViewProps) {
  /** Lightbox: 'anchor' = the installed image, otherwise a candidate filename. */
  const [lightbox, setLightbox] = useState<'anchor' | string | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const hasAnchor  = p.anchorUrl !== null;
  const approved   = hasAnchor && !!p.approvedAt;
  const previewCls = p.aspect === 'portrait' ? 'w-40 h-56' : 'w-56 h-40';
  const tileCls    = p.aspect === 'portrait' ? 'aspect-[3/4]' : 'aspect-video';
  const fitCls     = p.aspect === 'portrait' ? 'object-cover' : 'object-contain';
  const busy       = p.busy !== null;

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">{p.title}</h2>
        <span
          className={`text-xs px-2 py-0.5 rounded font-mono ${
            !hasAnchor
              ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              : approved
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                : 'bg-amber-900/40 text-amber-300 border border-amber-800'
          }`}
        >
          {!hasAnchor ? 'якоря нет' : approved ? 'якорь утверждён' : 'ждёт апрува'}
        </span>
      </div>

      <p className="text-xs text-zinc-500 mb-3">{p.hint}</p>

      {/* The anchor exists but only the machine has seen it. Say so loudly —
          this is the state that used to be invisible, and everything that
          depends on the anchor is blocked while it lasts. */}
      {hasAnchor && !approved && p.onApprove && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2">
          <span className="text-xs text-amber-200">
            Якорь поставлен автоматически — пока ты его не утвердишь, кадры с ним не рендерятся.
          </span>
          <button
            type="button"
            onClick={p.onApprove}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
          >
            {p.busy === 'approve' ? '…' : '✓ Утвердить якорь'}
          </button>
        </div>
      )}

      {/* stack below sm: превью якоря 224px + колонка кнопок не делят 375px —
          кнопкам оставалось ~30px ширины */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Installed anchor preview */}
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={() => hasAnchor && setLightbox('anchor')}
            disabled={!hasAnchor}
            className={`${previewCls} bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex items-center justify-center hover:border-purple-600 disabled:hover:border-zinc-800 disabled:cursor-default cursor-zoom-in`}
            title={hasAnchor ? 'Открыть полноразмер' : 'Якоря ещё нет'}
          >
            {hasAnchor ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={p.anchorUrl!} alt="anchor" className={`w-full h-full ${fitCls}`} />
            ) : (
              <div className="text-zinc-600 text-sm">no preview</div>
            )}
          </button>
          <div className="mt-1 text-center text-[11px] text-zinc-500">
            текущий якорь
            {p.anchorIsExternal && hasAnchor && (
              <span className="block text-amber-400">внешний файл (не из кандидатов)</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 flex-1">
          {p.controls}

          <button
            type="button"
            onClick={p.onGenerate}
            disabled={busy || !!p.activeJob || !!p.renderBlockedReason}
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded text-sm"
            title={p.renderBlockedReason ?? (p.activeJob ? 'Задание уже в очереди' : '')}
          >
            {p.activeJob
              ? `В очереди (${STATUS_LABEL[p.activeJob.status]})`
              : p.busy === 'enqueue'
                ? 'Ставлю в очередь…'
                : hasAnchor ? p.generateRegenLabel : p.generateIdleLabel}
          </button>
          {p.renderBlockedReason && (
            <div className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-900/60 rounded px-2 py-1">
              {p.renderBlockedReason}
            </div>
          )}

          <label className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded text-sm text-center cursor-pointer block">
            {p.busy === 'upload' ? 'Загружаю…' : hasAnchor ? 'Заменить файлом (PNG/JPG)' : 'Загрузить файлом (PNG/JPG)'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) p.onUpload(f);
                e.target.value = '';
              }}
            />
          </label>

          {hasAnchor && (
            <button
              type="button"
              onClick={p.onDelete}
              disabled={busy || !!p.activeJob}
              className="text-zinc-400 hover:text-red-400 disabled:opacity-50 border border-zinc-800 rounded px-4 py-2 text-sm"
              title="Удалить текущий якорь (потом можно сгенерировать заново)"
            >
              {p.busy === 'delete' ? 'Удаляю…' : 'Удалить якорь'}
            </button>
          )}

          {p.error && (
            <div className="bg-red-900/40 border border-red-800 rounded p-2 text-red-200 text-xs font-mono break-all">
              {p.error}
            </div>
          )}

          {p.lastJob && (
            <div className="text-xs text-zinc-500 mt-1">
              <span className={`inline-block px-2 py-0.5 rounded mr-2 ${STATUS_COLOR[p.lastJob.status]}`}>
                {STATUS_LABEL[p.lastJob.status]}
              </span>
              <span className="text-zinc-500">job {p.lastJob.id.slice(0, 8)}</span>
              {p.lastJob.note && <span className="text-zinc-600 ml-2 font-mono">{p.lastJob.note}</span>}
              {p.lastJob.errorMessage && (
                <div className="text-red-300 mt-1 font-mono break-all">{p.lastJob.errorMessage}</div>
              )}
            </div>
          )}

          {p.validation && (
            <div className="mt-2 border-t border-zinc-800 pt-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                Проверка ИИ (анти-аниме + выбор лучшего)
              </span>
              <div className="flex items-center gap-2">
                {p.validation.active && <span className="text-[11px] text-amber-400">проверяется…</span>}
                {!p.validation.active && p.validation.ran && (
                  <span className="text-[11px] text-zinc-500">
                    {p.validation.chosenFilename
                      ? <>🤖 выбор ИИ: <span className="text-emerald-400">{p.validation.chosenFilename}</span></>
                      : <span className="text-amber-400">⛔ годного портрета ИИ не нашёл</span>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={p.validation.onRevalidate}
                  disabled={busy || p.validation.active}
                  className="text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-2 py-0.5 rounded"
                >
                  🔁 перепроверить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Candidates gallery */}
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
          Кандидаты последнего рендера ({p.candidates.length})
        </div>
        {p.candidates.length === 0 ? (
          <div className="text-xs text-zinc-600">
            Кандидатов нет — запусти генерацию, рендер сложит сюда все варианты.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {p.candidates.map((c) => (
              <div
                key={c.filename}
                className={`rounded-lg overflow-hidden border bg-zinc-950 flex flex-col ${
                  c.selected ? 'border-purple-500 ring-2 ring-purple-500/40' : 'border-zinc-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(c.filename)}
                  className={`relative block ${tileCls} cursor-zoom-in`}
                  title="Открыть полноразмер"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.candidateUrl(c.filename)}
                    alt={c.filename}
                    className={`w-full h-full ${fitCls}`}
                    loading="lazy"
                  />
                  {p.validation && (
                    <div className="absolute top-1.5 left-1.5 flex gap-1">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${scoreBadgeCls(c.verdict)}`}>
                        {c.verdict ? (c.verdict.error ? 'err' : c.verdict.score) : '—'}
                      </span>
                      {c.verdict?.severe && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-100">⛔</span>
                      )}
                    </div>
                  )}
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
                  {p.validation && (
                    c.verdict ? (
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
                      <div className="text-[11px] text-zinc-600">
                        {p.validation.active ? 'проверяется…' : 'не проверялся'}
                      </div>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => p.onSelect(c.filename)}
                    disabled={busy || c.selected}
                    className={`mt-auto text-[11px] px-2 py-1 rounded ${
                      c.selected
                        ? 'bg-purple-900/40 text-purple-300 cursor-default'
                        : 'bg-zinc-800 hover:bg-purple-700 text-zinc-100'
                    }`}
                  >
                    {c.selected ? 'выбран якорем' : p.busy === 'select' ? '…' : 'сделать якорем'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {p.footer}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
            <div className="text-zinc-400 text-xs font-mono break-all">
              {lightbox === 'anchor' ? (p.anchorFilename ?? 'anchor') : lightbox}
            </div>
            <div className="flex gap-2">
              {lightbox === 'anchor' ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); p.onDelete(); setLightbox(null); }}
                  className="text-xs bg-red-700/80 hover:bg-red-600 text-white px-3 py-1 rounded"
                >
                  ✕ удалить
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); p.onSelect(lightbox); setLightbox(null); }}
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
            src={lightbox === 'anchor' ? p.anchorUrl! : p.candidateUrl(lightbox)}
            alt="anchor"
            className="max-w-[95vw] max-h-[90dvh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
