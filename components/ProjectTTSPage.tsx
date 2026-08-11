'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, SceneShot, ScenesResponse, TTSJob, TTSVoice, ProjectFull, ProjectTTSEmotionRef, TTSEngine, TTS_ENGINE_LABELS, VoVerdictView } from '../lib/api';

const PROSODY_LABELS: Record<string, string> = {
  monotone: 'монотонно', too_fast: 'слишком быстро', too_slow: 'слишком медленно',
  long_mid_silence: 'длинная пауза в середине', clipping: 'клиппинг',
};
const TECH_LABELS: Record<string, string> = {
  truncated_end: 'обрезан конец', leading_garbage: 'мусор в начале',
  too_short: 'слишком короткий', too_long: 'слишком длинный',
};

/** Полная расшифровка вердикта VO-QC для tooltip'а: за что именно сняты баллы —
 *  и на pass тоже (голый «QC ✓ 92» не объяснял недостающие 8, user 2026-08-07). */
function voVerdictTooltip(v: VoVerdictView): string {
  const lines: string[] = [];
  for (const i of v.issues ?? []) lines.push(i);
  if (typeof v.wer === 'number' && v.wer > 0) lines.push(`расхождение слов с текстом (WER): ${Math.round(v.wer * 100)}%`);
  if (v.missingWords?.length)  lines.push(`не услышано: ${v.missingWords.join(', ')}`);
  if (v.extraWords?.length)    lines.push(`лишнее: ${v.extraWords.join(', ')}`);
  if (v.repeatedWords?.length) lines.push(`заикание/повтор: ${v.repeatedWords.join(', ')}`);
  if (v.garbledWords?.length)  lines.push(`искажено: ${v.garbledWords.map((g) => `${g.expected} → ${g.heard}`).join('; ')}`);
  if (v.prosodyFlags?.length)  lines.push(`просодия: ${v.prosodyFlags.map((f) => PROSODY_LABELS[f] ?? f).join(', ')}`);
  if (v.techFlags?.length)     lines.push(`техника: ${v.techFlags.map((f) => TECH_LABELS[f] ?? f).join(', ')}`);
  if (v.riskyStressWords?.length) lines.push(`омографы (проверить ударение): ${v.riskyStressWords.join(', ')}`);
  if (v.textSnapshotStale) lines.push('⚠ текст кадра изменился после рендера этого дубля');
  if (lines.length === 0) return 'идеальное совпадение с текстом, претензий нет';
  if (v.transcript) lines.push(`распознано: «${v.transcript}»`);
  return lines.join('\n');
}

const SILERO_VOICE_LABELS: Record<TTSVoice, string> = {
  eugene:  'Eugene (м, спокойный диктор)',
  aidar:   'Aidar (м, уверенный)',
  baya:    'Baya (ж, нейтральная)',
  kseniya: 'Kseniya (ж, мягкая)',
  xenia:   'Xenia (ж, выразительная)',
  ruslan:  'Ruslan (м, бас) — только V3/V4',
  random:  'Random (новый голос каждый раз) — V3 only',
};

type SortMode = 'order' | 'unapproved_first' | 'approved_first';
const PAGE_SIZES = [20, 50, 100];

/** One flattened row: a shot plus the act (Scene row) it belongs to. */
interface Row {
  shot:     SceneShot;
  sceneId:  string;
  actKey:   string;
  actTitle: string;
  actOrder: number;
}

/**
 * Project-wide voiceover workbench — the full functionality of the old
 * per-act SceneShotsTTSModal (removed 2026-08-03), as a standalone tab:
 * every shot of the project in one paginated list, sortable by approval
 * status, filterable by act. Per-shot text edit + synth + takes + approve +
 * «понь»-trim + delete, plus bulk synth over the current filter.
 */
export function ProjectTTSPage({ projectId, initialSceneId }: { projectId: string; initialSceneId: string | null }) {
  const [scenes,      setScenes]      = useState<ScenesResponse | null>(null);
  const [project,     setProject]     = useState<ProjectFull | null>(null);
  const [emotionRefs, setEmotionRefs] = useState<ProjectTTSEmotionRef[]>([]);
  const [loadErr,     setLoadErr]     = useState<string | null>(null);

  // ── Engine-global knobs (mirror the old modal) ──────────────────────────
  const [voice,          setVoice]          = useState<TTSVoice>('baya');
  const [emotionRefName, setEmotionRefName] = useState<string>('');
  const [speed,          setSpeed]          = useState<number>(0.85);
  const [pause,          setPause]          = useState<number>(1);
  // Per-shot f5 overrides — undefined means "use the global value above".
  const [rowRate,  setRowRate]  = useState<Record<string, number>>({});
  const [rowPause, setRowPause] = useState<Record<string, number>>({});

  // ── List controls ────────────────────────────────────────────────────────
  const [actFilter, setActFilter] = useState<string>(initialSceneId ?? 'all');
  const [sortMode,  setSortMode]  = useState<SortMode>('order');
  const [page,      setPage]      = useState(0);
  const [pageSize,  setPageSize]  = useState(20);

  // ── Per-shot state ───────────────────────────────────────────────────────
  const [drafts,         setDrafts]         = useState<Record<string, string>>({});
  const [approvedByShot, setApprovedByShot] = useState<Record<string, string | null>>({});
  const [jobsByShot,     setJobsByShot]     = useState<Record<string, TTSJob[]>>({});
  const [saving,         setSaving]         = useState<Record<string, boolean>>({});
  const [busyAll,        setBusyAll]        = useState<false | 'all' | 'missing' | 'approve100'>(false);
  const [notice,         setNotice]         = useState<string | null>(null);
  const [err,            setErr]            = useState<string | null>(null);

  // ── Load: acts+shots, project (engine), emotion refs ────────────────────
  const loadScenes = useCallback(async () => {
    const data = await api.listScenes(projectId);
    setScenes(data);
    const shots = data.scenes.flatMap((sc) => sc.shots);
    // Seed drafts/approvals only for shots we haven't touched yet, so a
    // background reload doesn't wipe in-progress edits.
    setDrafts((d) => {
      const next = { ...d };
      for (const s of shots) if (next[s.id] === undefined) next[s.id] = s.narrationText ?? '';
      return next;
    });
    setApprovedByShot((a) => {
      const next = { ...a };
      for (const s of shots) if (next[s.id] === undefined) next[s.id] = s.approvedTTSJobId ?? null;
      return next;
    });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadScenes();
        const p = await api.getProject(projectId);
        if (cancelled) return;
        setProject(p);
        if ((p.ttsEngine ?? 'silero') !== 'silero') {
          const refs = await api.listProjectEmotionRefs(projectId);
          if (!cancelled) setEmotionRefs(refs);
        }
      } catch (e) {
        if (!cancelled) setLoadErr(asMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadScenes]);

  const engine = (project?.ttsEngine ?? 'silero') as TTSEngine;
  const voiceRefMissing = engine !== 'silero' && !!project && !project.ttsVoiceRefPath;

  // ── Rows: flatten → filter → sort → paginate ────────────────────────────
  const allRows: Row[] = useMemo(() => {
    if (!scenes) return [];
    return scenes.scenes.flatMap((sc) =>
      sc.shots.map((shot) => ({
        shot,
        sceneId:  sc.id,
        actKey:   sc.sceneKey,
        actTitle: sc.title ?? sc.sceneKey,
        actOrder: sc.sortOrder,
      })),
    );
  }, [scenes]);

  const isApproved = useCallback(
    (shotId: string) => !!approvedByShot[shotId],
    [approvedByShot],
  );

  const filtered = useMemo(() => {
    const base = actFilter === 'all' ? allRows : allRows.filter((r) => r.sceneId === actFilter);
    if (sortMode === 'order') return base;
    // Stable partition by approval status; original storyboard order inside
    // each bucket (Array.prototype.sort is stable).
    const want = sortMode === 'approved_first';
    return [...base].sort((a, b) => Number(isApproved(b.shot.id) === want) - Number(isApproved(a.shot.id) === want));
  }, [allRows, actFilter, sortMode, isApproved]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount - 1);
  const pageRows  = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, safePage, pageSize],
  );

  useEffect(() => { setPage(0); }, [actFilter, sortMode, pageSize]);

  // ── TTS jobs for the visible page only (a project has hundreds of shots) ──
  const pageIdsKey = useMemo(() => pageRows.map((r) => r.shot.id).join(','), [pageRows]);

  const refreshJobs = useCallback(async () => {
    const ids = pageIdsKey ? pageIdsKey.split(',') : [];
    if (ids.length === 0) return;
    const entries = await Promise.all(
      ids.map(async (id) => [id, await api.listShotTTSJobs(id).catch(() => [])] as const),
    );
    setJobsByShot((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [pageIdsKey]);

  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  // Poll while anything on this page is pending/running.
  useEffect(() => {
    const ids = new Set(pageIdsKey.split(','));
    const anyInflight = Object.entries(jobsByShot).some(
      ([id, jobs]) => ids.has(id) && jobs.some((j) => j.status === 'pending' || j.status === 'running'),
    );
    if (!anyInflight) return;
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, [jobsByShot, refreshJobs, pageIdsKey]);

  // ── Synth body (engine-aware, same rules as the old modal) ──────────────
  const synthBody = (shotId?: string): Parameters<typeof api.startShotTTS>[1] => {
    if (engine === 'silero') return { voice };
    const body: Parameters<typeof api.startShotTTS>[1] = {};
    if (emotionRefName) body.emotionRefName = emotionRefName;
    if (engine === 'f5') {
      body.rate = (shotId && rowRate[shotId] !== undefined) ? rowRate[shotId] : speed;
    }
    if (engine === 'f5' || engine === 'qwen3') {
      body.sentencePauseSec = (shotId && rowPause[shotId] !== undefined) ? rowPause[shotId] : pause;
    }
    return body;
  };

  // ── Per-shot actions ─────────────────────────────────────────────────────
  const withBusy = async (shotId: string, fn: () => Promise<void>) => {
    setSaving((s) => ({ ...s, [shotId]: true }));
    setErr(null);
    try { await fn(); }
    catch (e) { setErr(asMessage(e)); }
    finally { setSaving((s) => ({ ...s, [shotId]: false })); }
  };

  const saveText = (shotId: string) =>
    withBusy(shotId, async () => { await api.setShotNarrationText(shotId, drafts[shotId] ?? ''); });

  const renderOne = (shotId: string) =>
    withBusy(shotId, async () => {
      // Save first so what gets synthesised matches what's in the textarea.
      await api.setShotNarrationText(shotId, drafts[shotId] ?? '');
      await api.startShotTTS(shotId, synthBody(shotId));
      await refreshJobs();
    });

  const approveJob = (shotId: string, jobId: string) =>
    withBusy(shotId, async () => {
      const r = await api.approveTTSJob(jobId);
      setApprovedByShot((a) => ({ ...a, [shotId]: r.approvedTTSJobId ?? jobId }));
      await refreshJobs();
    });

  const deletePlayable = (shotId: string, jobId: string) => {
    if (!confirm('Удалить этот wav? Если он был утверждён — статус сбросится.')) return;
    return withBusy(shotId, async () => {
      await api.deleteTTSJob(jobId);
      setApprovedByShot((a) => (a[shotId] === jobId ? { ...a, [shotId]: null } : a));
      await refreshJobs();
    });
  };

  const trimArtifact = (shotId: string, jobId: string) =>
    withBusy(shotId, async () => {
      setNotice(null);
      const r = await api.trimTTSArtifact(jobId);
      setNotice(r.trimmed ? `«Понь» обрезан (−${r.cutMs ?? '?'} мс).` : `«Понь» не найден — файл не тронут${r.reason ? ` (${r.reason})` : ''}.`);
      await refreshJobs();
    });

  const revertArtifact = (shotId: string, jobId: string) =>
    withBusy(shotId, async () => {
      setNotice(null);
      await api.revertTTSArtifact(jobId);
      setNotice('Оригинал восстановлен.');
      await refreshJobs();
    });

  // ── Bulk synth over the CURRENT FILTER (not just the visible page) ──────
  const renderAll = async (mode: 'all' | 'missing') => {
    const scopeName = actFilter === 'all' ? 'всего проекта' : 'выбранного акта';
    if (mode === 'all' && !confirm(`Пересинтезировать ВСЕ кадры ${scopeName} (${filtered.length})? Существующие неутверждённые дубли останутся в истории, очередь получит по новому джобу на кадр.`)) return;
    setBusyAll(mode);
    setErr(null);
    let queued = 0;
    for (const r of filtered) {
      const text = (drafts[r.shot.id] ?? '').trim();
      if (!text) continue;
      if (mode === 'missing' && approvedByShot[r.shot.id]) continue;
      try {
        await api.setShotNarrationText(r.shot.id, text);
        await api.startShotTTS(r.shot.id, synthBody());
        queued++;
      } catch (e) {
        setErr(`Кадр ${r.shot.shotCode}: ${asMessage(e)}`);
        // Don't bail — keep queueing the rest.
      }
    }
    await refreshJobs();
    setBusyAll(false);
    if (queued === 0) setErr('Нечего озвучивать — у всех кадров либо пустой текст, либо уже есть утверждённая озвучка.');
    else setNotice(`Поставлено в очередь: ${queued}.`);
  };

  // ── Bulk approve: every un-approved take that QC scored a clean 100 ──────
  // Scope = current filter (same as bulk synth). Jobs of shots on other pages
  // are fetched on demand — jobsByShot only holds the visible page.
  const approveAll100 = async () => {
    setBusyAll('approve100');
    setErr(null); setNotice(null);
    let approved = 0, checked = 0;
    try {
      for (const r of filtered) {
        if (approvedByShot[r.shot.id]) continue;
        const jobs = jobsByShot[r.shot.id]
          ?? await api.listShotTTSJobs(r.shot.id).catch(() => [] as TTSJob[]);
        const take = jobs.find((j) =>
          j.status === 'completed' && j.voVerdict
          && j.voVerdict.status === 'pass' && j.voVerdict.score === 100
          && !j.voVerdict.textSnapshotStale);
        checked++;
        if (!take) continue;
        await api.approveTTSJob(take.id);
        setApprovedByShot((a) => ({ ...a, [r.shot.id]: take.id }));
        approved++;
      }
    } catch (e) {
      setErr(asMessage(e));
    }
    await refreshJobs();
    setBusyAll(false);
    setNotice(approved > 0
      ? `Утверждено по QC 100: ${approved}.`
      : `Стопроцентных неутверждённых дублей нет (проверено кадров: ${checked}).`);
  };

  // ── Counters over the current filter ────────────────────────────────────
  const totalWithText = filtered.filter((r) => (drafts[r.shot.id] ?? '').trim().length > 0).length;
  const totalApproved = filtered.filter((r) => isApproved(r.shot.id)).length;

  if (loadErr) return <main className="px-4 sm:px-8 py-6"><div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{loadErr}</div></main>;
  if (!scenes) return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;

  return (
    <main className="px-4 sm:px-8 py-6">
      <header className="mb-4 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-sm uppercase tracking-wider text-zinc-500">🔊 Озвучка кадров</h1>
        <span className="text-[10px] text-zinc-500">
          [engine: <span className={engine !== 'silero' ? 'text-emerald-300' : 'text-zinc-300'}>
            {engine === 'silero' ? TTS_ENGINE_LABELS.silero : `${TTS_ENGINE_LABELS[engine]} (voice clone)`}
          </span>]
        </span>
      </header>

      {voiceRefMissing && (
        <div className="mb-4 px-4 py-2 bg-amber-950/40 border border-amber-800/50 rounded text-amber-200 text-[11px]">
          ⚠ Voice-reference не загружен в настройках проекта — voice-clone синтез упадёт. Загрузи через{' '}
          <Link href={`/projects/${projectId}/settings`} className="text-amber-300 underline">настройки</Link> → секция 🎙 TTS Engine.
        </div>
      )}

      {/* Engine-global controls + bulk actions */}
      <div className="mb-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-end gap-4 flex-wrap">
        {engine === 'silero' && (
          <label className="text-xs flex flex-col gap-1">
            <span className="text-zinc-500 uppercase tracking-wider">Голос (применится ко всем)</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as TTSVoice)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 min-w-[260px]"
            >
              {(Object.keys(SILERO_VOICE_LABELS) as TTSVoice[]).map((v) => (
                <option key={v} value={v}>{SILERO_VOICE_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}
        {engine !== 'silero' && (
          <label className="text-xs flex flex-col gap-1">
            <span className="text-zinc-500 uppercase tracking-wider">Эмоция (применится ко всем)</span>
            {emotionRefs.length > 0 ? (
              <select
                value={emotionRefName}
                onChange={(e) => setEmotionRefName(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 min-w-[200px]"
              >
                <option value="">— нейтрально (голос-референс) —</option>
                {emotionRefs.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-zinc-500 py-1.5">
                нет референсов —{' '}
                <Link href={`/projects/${projectId}/settings`} className="text-emerald-400 hover:underline">
                  загрузить в настройках
                </Link>
              </span>
            )}
          </label>
        )}
        {engine === 'f5' && (
          <label className="text-xs flex flex-col gap-1">
            <span className="text-zinc-500 uppercase tracking-wider">Скорость ({speed.toFixed(2)}×)</span>
            <input
              type="range"
              min={0.5} max={2.0} step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-40"
            />
          </label>
        )}
        {(engine === 'f5' || engine === 'qwen3') && (
          <label className="text-xs flex flex-col gap-1">
            <span className="text-zinc-500 uppercase tracking-wider">Пауза, сек/предлож.</span>
            <input
              type="number"
              min={0} max={30} step={0.5}
              value={pause}
              onChange={(e) => setPause(Math.max(0, Math.min(30, parseFloat(e.target.value) || 0)))}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono w-24"
            />
          </label>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => renderAll('missing')}
            disabled={busyAll !== false || voiceRefMissing}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
            title="Синтез только для кадров без утверждённой озвучки (в рамках текущего фильтра)"
          >
            {busyAll === 'missing' ? '⏳' : '▶ Синтез новых'}
          </button>
          <button
            onClick={() => renderAll('all')}
            disabled={busyAll !== false || voiceRefMissing}
            className="bg-amber-700 hover:bg-amber-600 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
            title="Пересинтез всех кадров текущего фильтра (заменит существующие)"
          >
            {busyAll === 'all' ? '⏳' : '↻ Пересинтез всех'}
          </button>
          <button
            onClick={() => void approveAll100()}
            disabled={busyAll !== false}
            className="bg-emerald-800 hover:bg-emerald-700 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded"
            title="Утвердить все неутверждённые дубли с вердиктом QC pass и оценкой ровно 100 (в рамках текущего фильтра). Дубли со снятыми баллами остаются на ручную прослушку."
          >
            {busyAll === 'approve100' ? '⏳' : '✓✓ Утвердить все 100%'}
          </button>
        </div>
      </div>

      {/* Filter / sort / counters */}
      <div className="mb-3 flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-1.5 text-zinc-500">
          акт
          <select
            value={actFilter}
            onChange={(e) => setActFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 max-w-[280px]"
          >
            <option value="all">— все акты —</option>
            {scenes.scenes.map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.title ?? sc.sceneKey}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-zinc-500">
          сортировка
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
          >
            <option value="order">по порядку</option>
            <option value="unapproved_first">сначала без апрува</option>
            <option value="approved_first">сначала утверждённые</option>
          </select>
        </label>
        <span className="text-zinc-500">{filtered.length} кадров</span>
        <span className="text-zinc-500">📝 с текстом: {totalWithText}</span>
        <span className="text-zinc-500">✓ утверждено: <span className={totalApproved === filtered.length && filtered.length > 0 ? 'text-emerald-400' : ''}>{totalApproved}</span></span>
        {notice && (
          <span className="text-emerald-300 flex items-center gap-1">
            {notice}
            <button onClick={() => setNotice(null)} className="text-zinc-500 hover:text-zinc-200">✕</button>
          </span>
        )}
        {err && <span className="ml-auto text-red-400 font-mono break-all">{err}</span>}
      </div>

      {/* Per-shot rows (current page) */}
      <div className="space-y-2">
        {pageRows.map((r) => {
          const s              = r.shot;
          const jobs           = jobsByShot[s.id] ?? [];
          const latest         = jobs[0];
          // Most recent completed take — always show this audio player so the
          // user can listen before approving (and not only after).
          const latestCompleted = jobs.find((j) => j.status === 'completed') ?? null;
          const approvedJob    = jobs.find((j) => j.id === approvedByShot[s.id]);
          const playableJob    = approvedJob ?? latestCompleted;
          const draft          = drafts[s.id] ?? '';
          const dirty          = draft !== (s.narrationText ?? '');
          const isBusy         = saving[s.id] === true;
          const inFlight       = latest && (latest.status === 'pending' || latest.status === 'running');
          // Jobs not fetched yet → fall back to the scenes-list summary badge.
          const approvedNoJobs = !jobsByShot[s.id] && !!approvedByShot[s.id];

          return (
            <div key={s.id} className={
              `bg-zinc-950 border rounded p-3 ${(approvedJob || approvedNoJobs) ? 'border-emerald-800/60' : latestCompleted ? 'border-amber-800/40' : 'border-zinc-800'}`
            }>
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <span className="font-mono text-xs text-zinc-300">
                  <Link
                    href={`/projects/${projectId}/shots/${s.id}/narration`}
                    className="hover:text-blue-300 hover:underline"
                    title="Открыть страницу озвучки кадра"
                  >
                    {s.shotCode}
                  </Link>
                  <span className="ml-2 text-zinc-600 font-sans" title={r.actKey}>{r.actTitle}</span>
                </span>
                <div className="flex items-center gap-2 text-[10px] flex-1 justify-end flex-wrap">
                  {(approvedJob || approvedNoJobs) && (
                    <span className="text-emerald-400 font-mono">✓ утверждён</span>
                  )}
                  {!approvedJob && !approvedNoJobs && latestCompleted && (
                    <span className="text-amber-300 font-mono">🔊 готов, не утверждён</span>
                  )}
                  {/* VO-QC verdict of the take being played/approved. */}
                  {playableJob?.voVerdict && (
                    <span
                      title={voVerdictTooltip(playableJob.voVerdict)}
                      className={`font-mono border rounded px-1 cursor-help ${
                        playableJob.voVerdict.status === 'pass' ? 'text-emerald-400 border-emerald-800'
                        : playableJob.voVerdict.status === 'warn' ? 'text-amber-300 border-amber-800'
                        : 'text-red-300 border-red-800'
                      }`}
                    >
                      QC {playableJob.voVerdict.status === 'pass' ? '✓'
                        : playableJob.voVerdict.status === 'warn' ? '⚠'
                        : playableJob.voVerdict.status === 'fail' ? '✗' : '?'}
                      {typeof playableJob.voVerdict.score === 'number' ? ` ${playableJob.voVerdict.score}` : ''}
                    </span>
                  )}
                  {inFlight && (
                    <span className="text-blue-300 font-mono">
                      {latest!.status === 'running' ? '⚙ рендерится' : '⏳ в очереди'}
                    </span>
                  )}
                  {latest && latest.status === 'failed' && (
                    <span className="text-red-400 font-mono" title={latest.errorMessage ?? ''}>✕ упал</span>
                  )}
                  {playableJob && (
                    <audio
                      controls
                      preload="none"
                      src={api.ttsFileUrl(playableJob.id)}
                      className="h-7 max-w-[260px]"
                    />
                  )}
                  {latestCompleted && !approvedJob && (
                    <button
                      onClick={() => approveJob(s.id, latestCompleted.id)}
                      disabled={isBusy}
                      title="Утвердить этот wav как канонический для кадра"
                      className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-[10px] px-2 py-0.5 rounded"
                    >
                      {isBusy ? '⏳' : '✓ утвердить'}
                    </button>
                  )}
                  {/* «понь»-обрезка — на утверждённой озвучке (как на странице narration) */}
                  {approvedJob && approvedJob.status === 'completed' && !approvedJob.trimmedArtifact && (
                    <button
                      onClick={() => trimArtifact(s.id, approvedJob.id)}
                      disabled={isBusy}
                      title="Обрезать ведущий артефакт «понь» (обратимо)"
                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-[10px] px-2 py-0.5 rounded"
                    >
                      {isBusy ? '⏳' : '✂ понь'}
                    </button>
                  )}
                  {approvedJob && approvedJob.status === 'completed' && approvedJob.trimmedArtifact && (
                    <button
                      onClick={() => revertArtifact(s.id, approvedJob.id)}
                      disabled={isBusy}
                      title="Вернуть оригинал (отменить обрезку «понь»)"
                      className="bg-amber-800 hover:bg-amber-700 disabled:opacity-30 text-white text-[10px] px-2 py-0.5 rounded"
                    >
                      {isBusy ? '⏳' : '↩ вернуть'}
                    </button>
                  )}
                  {playableJob && (
                    <button
                      onClick={() => deletePlayable(s.id, playableJob.id)}
                      disabled={isBusy}
                      title={approvedJob ? 'Удалить утверждённый wav (approval тоже сбросится)' : 'Удалить этот wav'}
                      className="bg-red-900/40 hover:bg-red-800/60 border border-red-900/60 hover:border-red-700 disabled:opacity-30 text-red-300 hover:text-red-200 text-[10px] px-2 py-0.5 rounded"
                    >
                      {isBusy ? '⏳' : '✕ удалить'}
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                placeholder="Текст озвучки этого кадра…"
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm text-zinc-200 font-sans resize-y"
              />
              <div className="flex items-center gap-2 mt-1.5">
                {/* Per-shot f5 override — defaults to the global value above; 🎙 озвучить
                    for THIS shot uses it. Bulk synth stays uniform (global). */}
                {engine === 'f5' && (
                  <div className="flex items-center gap-2 mr-auto">
                    <label className="text-[10px] text-zinc-500 flex items-center gap-1" title="Скорость для этого кадра (по умолчанию — общая)">
                      скорость
                      <input
                        type="number" min={0.5} max={2.0} step={0.05}
                        value={rowRate[s.id] ?? speed}
                        onChange={(e) => setRowRate((prev) => ({ ...prev, [s.id]: Math.max(0.5, Math.min(2.0, parseFloat(e.target.value) || speed)) }))}
                        className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200 font-mono w-14"
                      />
                    </label>
                    <label className="text-[10px] text-zinc-500 flex items-center gap-1" title="Пауза между предложениями для этого кадра">
                      пауза
                      <input
                        type="number" min={0} max={30} step={0.5}
                        value={rowPause[s.id] ?? pause}
                        onChange={(e) => setRowPause((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(30, parseFloat(e.target.value) || 0)) }))}
                        className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200 font-mono w-14"
                      />
                    </label>
                    {(rowRate[s.id] !== undefined || rowPause[s.id] !== undefined) && (
                      <button
                        onClick={() => { setRowRate((prev) => { const n = { ...prev }; delete n[s.id]; return n; }); setRowPause((prev) => { const n = { ...prev }; delete n[s.id]; return n; }); }}
                        title="Сбросить к общим значениям"
                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        ↺ общие
                      </button>
                    )}
                  </div>
                )}
                {dirty && (
                  <button
                    onClick={() => saveText(s.id)}
                    disabled={isBusy}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-[11px] px-2 py-0.5 rounded"
                  >
                    💾 сохранить
                  </button>
                )}
                <button
                  onClick={() => renderOne(s.id)}
                  disabled={isBusy || draft.trim().length === 0 || voiceRefMissing}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 text-white text-[11px] px-2 py-0.5 rounded"
                >
                  {isBusy ? '⏳' : '🎙 озвучить'}
                </button>
              </div>
            </div>
          );
        })}
        {pageRows.length === 0 && (
          <p className="text-zinc-600 text-sm italic">Нет кадров под текущий фильтр.</p>
        )}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
          className="border border-zinc-700 rounded px-3 py-1 disabled:opacity-30 hover:text-zinc-200"
        >
          ← назад
        </button>
        <span>стр. {safePage + 1} / {pageCount}</span>
        <button
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={safePage >= pageCount - 1}
          className="border border-zinc-700 rounded px-3 py-1 disabled:opacity-30 hover:text-zinc-200"
        >
          вперёд →
        </button>
        <label className="flex items-center gap-1.5 ml-auto">
          на странице
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </main>
  );
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
