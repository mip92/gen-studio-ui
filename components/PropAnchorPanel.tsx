'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Prop, PropAnchorCandidates, PropAnchorJob, PropAnchorPipeline } from '../lib/api';
import { AnchorPanelView } from './AnchorPanelView';

/**
 * Object anchor for a PROP. Fetching + wording only — the markup is
 * `AnchorPanelView`, the same component the character panel renders, because the
 * two do the same work and must not drift apart.
 *
 * Two props differ from the character call:
 *   - `validation` is omitted: the vision QC grades faces for anime and identity
 *     match, which means nothing for a sewing machine;
 *   - `aspect` is landscape: an object study is 16:9, a portrait is 3/4.
 * One is added: the engine picker, since a project can want Flux for faces and
 * Qwen+RealComic for objects.
 */

const PIPELINES: Array<{ value: PropAnchorPipeline; label: string }> = [
  { value: 'qwen',       label: 'Qwen + RealComic' },
  { value: 'flux_comic', label: 'Flux comic' },
  { value: 'sdxl_comic', label: 'SDXL comic' },
];

const POLL_MS = 3000;

export function PropAnchorPanel({ prop, onChanged }: { prop: Prop; onChanged: () => void }) {
  const [jobs,     setJobs]     = useState<PropAnchorJob[] | null>(null);
  const [cands,    setCands]    = useState<PropAnchorCandidates | null>(null);
  const [busy,     setBusy]     = useState<'enqueue' | 'upload' | 'delete' | 'select' | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PropAnchorPipeline | ''>('');
  const [anchorBust, setAnchorBust] = useState(Date.now());
  const prevCompleted = useRef<string | null>(null);
  const pollTimer     = useRef<NodeJS.Timeout | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([
        api.listPropAnchorJobs(prop.id),
        api.listPropAnchorCandidates(prop.id).catch(() => null),
      ]);
      setJobs(j);
      setCands(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [prop.id]);

  useEffect(() => {
    void loadAll();
    pollTimer.current = setInterval(() => { void loadAll(); }, POLL_MS);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [loadAll]);

  // A finished render is the ONLY thing that refreshes the parent list — a queue
  // click must not make the page reload under the user.
  useEffect(() => {
    const done = jobs?.find((j) => j.status === 'completed');
    if (done && done.id !== prevCompleted.current) {
      prevCompleted.current = done.id;
      setAnchorBust(Date.now());
      onChanged();
    }
  }, [jobs, onChanged]);

  const wrap = (tag: NonNullable<typeof busy>, fn: () => Promise<unknown>, touchesAnchor = false) => async () => {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      await loadAll();
      if (touchesAnchor) { setAnchorBust(Date.now()); onChanged(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить якорь предмета? После удаления можно сгенерировать заново или выбрать кандидата.')) return;
    await wrap('delete', () => api.deletePropAnchor(prop.id), true)();
  };

  const activeJob = jobs?.find((j) => j.status === 'pending' || j.status === 'running') ?? null;
  const lastJob   = jobs?.[0] ?? null;

  return (
    <AnchorPanelView
      title="Якорь предмета (object anchor)"
      hint={
        <>
          Без якоря предмет доезжает до модели одним текстом, а текст не держит форму — та же швейная
          машинка в каждом кадре получается другая. Рендер делает несколько кандидатов, первый ставится
          якорем, но финальный выбор за тобой. У человека якорь отвечает только за лицо и волосы,
          у предмета — за весь объект: форму и цвет.
        </>
      }
      aspect="landscape"
      anchorUrl={prop.anchorPath ? api.propAnchorRawUrl(prop.id, anchorBust) : null}
      anchorFilename={prop.anchorPath?.split(/[\\/]/).pop() ?? null}
      anchorIsExternal={cands?.anchorIsExternal}
      candidateUrl={(f) => api.propAnchorCandidateUrl(prop.id, f)}
      candidates={cands?.candidates ?? []}
      lastJob={lastJob ? { ...lastJob, note: lastJob.pipeline ?? null } : null}
      activeJob={activeJob}
      busy={busy}
      error={error}
      onGenerate={wrap('enqueue', () => api.generatePropAnchor(prop.id, pipeline || undefined))}
      onUpload={(f) => void wrap('upload', () => api.uploadPropAnchor(prop.id, f), true)()}
      onDelete={handleDelete}
      onSelect={(f) => void wrap('select', () => api.selectPropAnchorCandidate(prop.id, f), true)()}
      generateIdleLabel="Сгенерировать по описанию (очередь)"
      generateRegenLabel="Перерендерить по описанию (очередь)"
      controls={
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500 block mb-1">Чем рисовать</span>
          <select
            value={pipeline}
            onChange={(e) => setPipeline(e.target.value as PropAnchorPipeline | '')}
            disabled={busy !== null}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
          >
            <option value="">как настроено в проекте</option>
            {PIPELINES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
      }
    />
  );
}
