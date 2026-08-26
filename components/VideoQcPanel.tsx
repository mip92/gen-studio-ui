'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api, VideoQcReadiness, VideoQcReportRow, VideoQcRun,
} from '../lib/api';
import { useLiveEvents, on } from '../lib/liveEvents';

/**
 * «Видео QC» — project page for QC of completed i2v base clips. Same
 * philosophy as «Кадры QC»/«Озвучка QC»: глазами смотрим только не-pass.
 *
 *   Layer A (deterministic): статичный клип, синие лица (hue против исходного
 *   кадра), расплав анатомии к концу, новые субъекты, рывки, дрейф стиля.
 *   Layer B (Qwen-VL, точечно): классификация подозрительных кадров —
 *   аниме-пришелец.
 *
 * ONE queue job per project run; проверяются ВСЕ completed-дубли (бейджи
 * помогают выбирать), финальный клип QC не выбирает и не блокирует.
 */
export function VideoQcPanel({ projectId }: { projectId: string }) {
  const [readiness, setReadiness] = useState<VideoQcReadiness | null>(null);
  const [latest,    setLatest]    = useState<VideoQcRun | null>(null);
  const [report,    setReport]    = useState<VideoQcReportRow[] | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState<string | null>(null);
  const [notice,    setNotice]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, l, rep] = await Promise.all([
        api.videoQcReadiness(projectId),
        api.latestVideoQcRun(projectId),
        api.videoQcReport(projectId),
      ]);
      setReadiness(r); setLatest(l); setReport(rep);
    } catch (e) { setErr(asMessage(e)); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const inFlight = latest && (latest.status === 'pending' || latest.status === 'running');
  // Was a 3s poll while a run was in flight. The run IS a queue job, so the
  // backend says when it moves and the refetch is the same three reads.
  const qcMatch = useCallback(on.all(on.project(projectId), on.types('video_qc')), [projectId]);
  useLiveEvents(qcMatch, refresh, { active: !!inFlight });

  const start = async () => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await api.runVideoQc(projectId);
      setNotice(res.queued
        ? `Проверка поставлена в очередь (${res.mode === 'full' ? 'полная' : 'инкрементальная'}, ${res.totalClips} клипов).`
        : `Не запущено: ${res.reason ?? '—'}`);
      await refresh();
    } catch (e) { setErr(asMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-lg font-semibold text-zinc-200">🎞 Видео QC</h1>
      <p className="text-sm text-zinc-500">
        Автопроверка готовых клипов: статичность, синие лица (против исходного
        кадра), расплав анатомии к концу, чужие субъекты в кадре (включая
        аниме-пришельцев), рывки и дрейф стиля. Глазами смотрим только то, что
        не прошло. Финальный клип НЕ выбирается и НЕ блокируется автоматически.
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
                  ? 'Веса DWPose не установлены'
                  : !readiness.ready
                    ? `Сначала отрендерите видео всем animated-шотам — без клипа: ${readiness.missingShotCodes.slice(0, 10).join(', ')}${readiness.missingShotCodes.length > 10 ? '…' : ''}`
                    : inFlight ? 'Проверка уже идёт' : ''}
                className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-30 text-white text-sm font-medium px-4 py-1.5 rounded"
              >
                {inFlight ? '⏳ идёт проверка…' : '▶ Проверить видео'}
              </button>
              <span className="text-xs text-zinc-500">
                клипы у {readiness.withVideo}/{readiness.totalAnimated} animated-шотов · {readiness.totalClips} клипов
                {readiness.hasCompletedRun
                  ? ` · повторный запуск проверит только новое (${readiness.dueClips})`
                  : ' · первый запуск проверит все клипы'}
              </span>
            </div>
            {!readiness.ready && readiness.missingShotCodes.length > 0 && (
              <p className="text-xs text-amber-300/80">
                Без видео: {readiness.missingShotCodes.join(', ')}
              </p>
            )}
          </>
        )}

        {latest && (
          <div className="text-xs font-mono text-zinc-400 border-t border-zinc-800 pt-2 space-y-1">
            <div>
              последний запуск: {latest.mode} · {latest.status}
              {inFlight && ` · ${latest.processedClips}/${latest.totalClips}`}
              {latest.errorMessage && <span className="text-red-300"> · {latest.errorMessage}</span>}
            </div>
            {inFlight && latest.totalClips > 0 && (
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden max-w-md">
                <div className="h-full bg-indigo-600 transition-all"
                     style={{ width: `${Math.round((latest.processedClips / latest.totalClips) * 100)}%` }} />
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
              <div key={r.videoRenderId}
                   className="flex items-start gap-3 px-2 py-1.5 rounded border border-zinc-800/60 text-xs">
                <video
                  src={api.videoFileUrl(r.videoRenderId)}
                  muted loop playsInline preload="metadata" controls
                  className="w-44 rounded border border-zinc-800 shrink-0"
                />
                <span className={`font-mono shrink-0 mt-1 ${
                  r.status === 'warn' ? 'text-amber-300' : 'text-red-300'
                }`}>
                  {r.status === 'warn' ? '⚠' : r.status === 'fail' ? '✗' : '?'}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.shotId ? (
                      <Link href={`/projects/${projectId}/shots/${r.shotId}/videos${r.videoRenderId ? `/${r.videoRenderId}` : ''}`}
                            className="font-mono text-zinc-300 hover:text-indigo-300">
                        {r.shotCode ?? '?'}
                      </Link>
                    ) : (
                      <span className="font-mono text-zinc-300">{r.shotCode ?? '?'}</span>
                    )}
                    <span className="font-mono text-zinc-600">{r.filename ?? ''}</span>
                    {r.isChosen && <span className="text-emerald-400" title="этот клип сейчас выбран финальным">✓ финал</span>}
                  </div>
                  <div className="text-zinc-400">
                    {(r.issues ?? []).join('; ') || '—'}
                  </div>
                  {r.suspicious?.length > 0 && (
                    <div className="text-zinc-500">
                      подозрительные моменты: {r.suspicious.map((s) => `${s.timeSec}с (${s.reason})`).join(', ')}
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
