'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api, ImageQcReadiness, ImageQcReportRow, ImageQcRun,
} from '../lib/api';
import { useLiveEvents, on } from '../lib/liveEvents';

/**
 * «Кадры QC» — project page for image QC of rendered shot candidates.
 * Same philosophy as «Озвучка QC» (user 2026-08-07): глазами смотрим ТОЛЬКО
 * то, что не прошло автоматику — the report below IS the review worklist.
 *
 *   Layer 1 (deterministic): DWPose skeletons + scrfd faces — карлики, две
 *   головы, число людей против ShotParticipants, слипшиеся фигуры, зеркала.
 *   Layer 2 (Qwen fact-checklist): только шоты с ключевым предметом (prop) —
 *   «что за предмет, часть чего» против описания предмета.
 *
 * ONE queue job per project run («как в аудио»); re-runs score only
 * candidates without a verdict. QC never picks a frame — выбор кадра за вами.
 */
export function ImageQcPanel({ projectId }: { projectId: string }) {
  const [readiness, setReadiness] = useState<ImageQcReadiness | null>(null);
  const [latest,    setLatest]    = useState<ImageQcRun | null>(null);
  const [report,    setReport]    = useState<ImageQcReportRow[] | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState<string | null>(null);
  const [notice,    setNotice]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, l, rep] = await Promise.all([
        api.imageQcReadiness(projectId),
        api.latestImageQcRun(projectId),
        api.imageQcReport(projectId),
      ]);
      setReadiness(r); setLatest(l); setReport(rep);
    } catch (e) { setErr(asMessage(e)); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Was a 3s poll while a run was in flight. The run IS a queue job, so the
  // backend says when it moves and the refetch is the same three reads.
  const inFlight = latest && (latest.status === 'pending' || latest.status === 'running');
  const qcMatch = useCallback(on.all(on.project(projectId), on.types('image_qc')), [projectId]);
  useLiveEvents(qcMatch, refresh, { active: !!inFlight });

  const start = async () => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await api.runImageQc(projectId);
      setNotice(res.queued
        ? `Проверка поставлена в очередь (${res.mode === 'full' ? 'полная' : 'инкрементальная'}, ${res.totalImages} кадров).`
        : `Не запущено: ${res.reason ?? '—'}`);
      await refresh();
    } catch (e) { setErr(asMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-lg font-semibold text-zinc-200">🖼 Кадры QC</h1>
      <p className="text-sm text-zinc-500">
        Автопроверка отрендеренных кандидатов: скелеты (карлики, две головы,
        число людей, слипшиеся фигуры, зеркала) + факт-проверка ключевого
        предмета нейронкой. Глазами смотрим только то, что не прошло —
        «pass» можно не открывать. Лучший кадр НЕ выбирается автоматически.
      </p>

      {err &&    <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded px-3 py-2">{err}</div>}
      {notice && <div className="text-sm text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded px-3 py-2">{notice}</div>}

      {/* Run control */}
      <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
        {!readiness && <p className="text-zinc-500 text-sm">Загрузка…</p>}
        {readiness && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={start}
                disabled={busy || !readiness.ready || !readiness.modelsInstalled || !!inFlight}
                title={!readiness.modelsInstalled
                  ? 'Веса DWPose не установлены (yolox_l.onnx / dw-ll_ucoco_384.onnx)'
                  : !readiness.ready
                    ? `Сначала отрендерите все кадры — без кандидатов: ${readiness.missingShotCodes.slice(0, 10).join(', ')}${readiness.missingShotCodes.length > 10 ? '…' : ''}`
                    : inFlight ? 'Проверка уже идёт' : ''}
                className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-30 text-white text-sm font-medium px-4 py-1.5 rounded"
              >
                {inFlight ? '⏳ идёт проверка…' : '▶ Проверить кадры'}
              </button>
              <span className="text-xs text-zinc-500">
                отрендерено {readiness.withRenders}/{readiness.totalShots} шотов · {readiness.totalImages} кандидатов
                {readiness.hasCompletedRun
                  ? ` · повторный запуск проверит только новое (${readiness.dueImages})`
                  : ' · первый запуск проверит все кандидаты'}
              </span>
            </div>
            {!readiness.modelsInstalled && (
              <p className="text-xs text-red-300/80">
                Веса DWPose не найдены — скачайте yolox_l.onnx и dw-ll_ucoco_384.onnx
                (см. IMAGE_QC_DET_MODEL / IMAGE_QC_POSE_MODEL).
              </p>
            )}
            {!readiness.ready && readiness.missingShotCodes.length > 0 && (
              <p className="text-xs text-amber-300/80">
                Без рендеров: {readiness.missingShotCodes.join(', ')}
              </p>
            )}
          </>
        )}

        {/* Latest run progress / summary */}
        {latest && (
          <div className="text-xs font-mono text-zinc-400 border-t border-zinc-800 pt-2 space-y-1">
            <div>
              последний запуск: {latest.mode} · {latest.status}
              {inFlight && ` · ${latest.processedImages}/${latest.totalImages}`}
              {latest.errorMessage && <span className="text-red-300"> · {latest.errorMessage}</span>}
            </div>
            {inFlight && latest.totalImages > 0 && (
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden max-w-md">
                <div className="h-full bg-indigo-600 transition-all"
                     style={{ width: `${Math.round((latest.processedImages / latest.totalImages) * 100)}%` }} />
              </div>
            )}
            {latest.status === 'completed' && latest.summary && (
              <div>
                <span className="text-emerald-400">✓ pass {latest.summary.pass}</span>
                {' · '}<span className="text-amber-300">⚠ warn {latest.summary.warn}</span>
                {' · '}<span className="text-red-300">✗ fail {latest.summary.fail}</span>
                {' · '}<span className="text-red-400">? error {latest.summary.error}</span>
                {latest.summary.skippedMissingFile > 0 && ` · без файла: ${latest.summary.skippedMissingFile}`}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Manual-review worklist */}
      <section className="bg-zinc-900 border border-zinc-800 rounded">
        <div className="px-4 py-2 text-xs uppercase tracking-wider text-zinc-500">
          На ручной просмотр {report ? `(${report.length})` : ''}
        </div>
        {!report && <p className="px-4 pb-3 text-zinc-500 text-sm">Загрузка…</p>}
        {report && report.length === 0 && (
          <p className="px-4 pb-3 text-zinc-500 text-sm italic">— всё чисто, смотреть нечего —</p>
        )}
        {report && report.length > 0 && (
          <div className="px-2 pb-3 space-y-1">
            {report.map((r) => (
              <div key={`${r.shotId}-${r.filename}`}
                   className="flex items-start gap-3 px-2 py-1.5 rounded border border-zinc-800/60 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={api.shotImageUrl(r.shotId, r.filename)}
                  alt={r.filename}
                  loading="lazy"
                  className="w-28 h-16 object-cover rounded border border-zinc-800 shrink-0"
                />
                <span className={`font-mono shrink-0 mt-1 ${
                  r.status === 'warn' ? 'text-amber-300' : 'text-red-300'
                }`}>
                  {r.status === 'warn' ? '⚠' : r.status === 'fail' ? '✗' : '?'}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/projects/${projectId}/shots/${r.shotId}/render`}
                          className="font-mono text-zinc-300 hover:text-indigo-300">
                      {r.shotCode ?? r.shotId.slice(0, 8)}
                    </Link>
                    <span className="font-mono text-zinc-600">{r.filename}</span>
                    {r.isChosen && <span className="text-emerald-400" title="этот кандидат сейчас выбран для кадра">✓ выбран</span>}
                    {r.peopleExpected != null && r.peopleFound != null && r.peopleFound !== r.peopleExpected && (
                      <span className="text-amber-300/80" title="людей найдено / заявлено">👥 {r.peopleFound}/{r.peopleExpected}</span>
                    )}
                  </div>
                  <div className="text-zinc-400">
                    {(r.issues ?? []).join('; ') || '—'}
                  </div>
                  {r.factAnswers && (
                    <div className="text-zinc-500">
                      предмет: «{r.factAnswers.objectSeen ?? '?'}»
                      {r.factAnswers.isPartOf ? ` · часть: ${r.factAnswers.isPartOf}` : ''}
                      {r.factAnswers.reason ? ` · ${r.factAnswers.reason}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
