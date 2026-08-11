'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api, VoValidationReadiness, VoValidationReportRow, VoValidationRun,
} from '../lib/api';

/**
 * «Озвучка QC» — project page for VO validation (audio QC of rendered
 * narration). Workflow (user 2026-08-03): руками слушаем ТОЛЬКО то, что не
 * прошло автоматическую проверку — the report below IS the listening worklist.
 *
 *   1. The run button unlocks once EVERY shot with narration has ≥1 completed
 *      take; first run validates everything, re-runs only the unapproved delta.
 *   2. The opt-in gate toggle blocks TTS approval until the first completed
 *      run (per-project, default off).
 *   3. The report lists warn/fail/error verdicts, worst first.
 */
export function VoValidationPanel({ projectId }: { projectId: string }) {
  const [readiness, setReadiness] = useState<VoValidationReadiness | null>(null);
  const [latest,    setLatest]    = useState<VoValidationRun | null>(null);
  const [report,    setReport]    = useState<VoValidationReportRow[] | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState<string | null>(null);
  const [notice,    setNotice]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, l, rep] = await Promise.all([
        api.voValidationReadiness(projectId),
        api.latestVoValidationRun(projectId),
        api.voValidationReport(projectId),
      ]);
      setReadiness(r); setLatest(l); setReport(rep);
    } catch (e) { setErr(asMessage(e)); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while a run is in flight — same 3s idiom as the TTS tabs.
  const inFlight = latest && (latest.status === 'pending' || latest.status === 'running');
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  const start = async () => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await api.runVoValidation(projectId);
      setNotice(res.queued
        ? `Проверка поставлена в очередь (${res.mode === 'full' ? 'полная' : 'инкрементальная'}, ${res.totalJobs} дублей).`
        : `Не запущено: ${res.reason ?? '—'}`);
      await refresh();
    } catch (e) { setErr(asMessage(e)); }
    finally { setBusy(false); }
  };

  const toggleGate = async () => {
    if (!readiness) return;
    setBusy(true); setErr(null);
    try {
      await api.setVoValidationGate(projectId, !readiness.gateEnabled);
      await refresh();
    } catch (e) { setErr(asMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-lg font-semibold text-zinc-200">🎙 Озвучка QC</h1>
      <p className="text-sm text-zinc-500">
        Автопроверка рендеренной озвучки: whisper-транскрипт ↔ текст (пропуски,
        повторы, искажения слов), просодия, техартефакты, омографы. Руками
        слушаем только то, что не прошло — «pass» можно не слушать.
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
                disabled={busy || !readiness.ready || !!inFlight}
                title={!readiness.ready
                  ? `Сначала озвучьте все шоты — без completed TTS: ${readiness.missingShotCodes.slice(0, 10).join(', ')}${readiness.missingShotCodes.length > 10 ? '…' : ''}`
                  : inFlight ? 'Проверка уже идёт' : ''}
                className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-sm font-medium px-4 py-1.5 rounded"
              >
                {inFlight ? '⏳ идёт проверка…' : '▶ Проверить озвучку'}
              </button>
              <span className="text-xs text-zinc-500">
                озвучено {readiness.withCompleted}/{readiness.totalWithText} шотов с текстом
                {readiness.hasCompletedRun ? ' · повторный запуск проверит только неутверждённое' : ' · первый запуск проверит все дубли'}
              </span>
            </div>
            {!readiness.ready && readiness.missingShotCodes.length > 0 && (
              <p className="text-xs text-amber-300/80">
                Без озвучки: {readiness.missingShotCodes.join(', ')}
              </p>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={readiness.gateEnabled} onChange={toggleGate}
                     disabled={busy} className="accent-emerald-600" />
              гейт: запрещать «утвердить» озвучку, пока проект не прошёл проверку хотя бы раз
            </label>
          </>
        )}

        {/* Latest run progress / summary */}
        {latest && (
          <div className="text-xs font-mono text-zinc-400 border-t border-zinc-800 pt-2 space-y-1">
            <div>
              последний запуск: {latest.mode} · {latest.status}
              {inFlight && ` · ${latest.processedJobs}/${latest.totalJobs}`}
              {latest.errorMessage && <span className="text-red-300"> · {latest.errorMessage}</span>}
            </div>
            {inFlight && latest.totalJobs > 0 && (
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden max-w-md">
                <div className="h-full bg-emerald-600 transition-all"
                     style={{ width: `${Math.round((latest.processedJobs / latest.totalJobs) * 100)}%` }} />
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

      {/* Manual-listening worklist */}
      <section className="bg-zinc-900 border border-zinc-800 rounded">
        <div className="px-4 py-2 text-xs uppercase tracking-wider text-zinc-500">
          На ручную прослушку {report ? `(${report.length})` : ''}
        </div>
        {!report && <p className="px-4 pb-3 text-zinc-500 text-sm">Загрузка…</p>}
        {report && report.length === 0 && (
          <p className="px-4 pb-3 text-zinc-500 text-sm italic">— всё чисто, слушать нечего —</p>
        )}
        {report && report.length > 0 && (
          <div className="px-2 pb-3 space-y-1">
            {report.map((r) => (
              // flex-wrap: статус + код кадра + текст проблем + аудиоплеер
              // (220px, shrink-0) шире телефона — плеер переносится на свою
              // строку вместо выталкивания за экран
              <div key={r.ttsJobId}
                   className="flex flex-wrap items-start gap-3 gap-y-1.5 px-2 py-1.5 rounded border border-zinc-800/60 text-xs">
                <span className={`font-mono shrink-0 ${
                  r.status === 'warn' ? 'text-amber-300' : 'text-red-300'
                }`}>
                  {r.status === 'warn' ? '⚠' : r.status === 'fail' ? '✗' : '?'}
                  {typeof r.score === 'number' ? ` ${r.score}` : ''}
                </span>
                {r.shotId ? (
                  <Link href={`/projects/${projectId}/shots/${r.shotId}/narration`}
                        className="font-mono text-zinc-300 hover:text-emerald-300 shrink-0">
                    {r.shotCode}
                  </Link>
                ) : (
                  <span className="font-mono text-zinc-300 shrink-0">{r.sceneKey ?? '?'}</span>
                )}
                {r.approved && <span className="text-emerald-400 shrink-0" title="этот дубль утверждён">✓</span>}
                <span className="text-zinc-400 min-w-0">
                  {(r.issues ?? []).join('; ') || '—'}
                  {r.riskyStressWords?.length > 0 && (
                    <span className="text-zinc-500"> · омографы: {r.riskyStressWords.join(', ')}</span>
                  )}
                  {r.textSnapshotStale && <span className="text-amber-300/80"> · текст изменился после рендера</span>}
                </span>
                <audio controls preload="none" src={api.ttsFileUrl(r.ttsJobId)}
                       className="h-6 ml-auto shrink-0 max-w-[220px]" />
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
