'use client';

/**
 * BGM page for a single project. Surfaces NarrativeBlocks with their segments
 * and ACE-Step render history. All actions go through lib/api.ts wrappers
 * which hit /bgm/* endpoints on the gen-studio backend. Audio is streamed
 * directly from /bgm/jobs/<id>/file (no pre-download).
 *
 * Refresh strategy: 5s poll while the user is on the page, same cadence as
 * ScenesList — matches backend's PipelineQueueService tick interval so the
 * UI lags at most one tick behind queue state changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, NarrativeBlock, MusicSegment, AudioRenderJob } from '../lib/api';

/** Valid ACE-Step meta values, fetched from the backend (which mirrors the
 *  ComfyUI node's combo options). Null until the fetch lands. */
type MetaOptions = {
  bpm:            { min: number; max: number };
  keyscales:      string[];
  timesignatures: string[];
};

/**
 * Does this caption still state a tempo, key or metre in its text, where it
 * fights the `# Metas` block the tokenizer appends? Advisory only — never blocks
 * a save. Twin of `captionMetaConflicts()` in the backend's bgm.types.ts; keep
 * the two in step (there is no shared module between the API and this app).
 */
function captionMetaConflicts(prompt: string): string[] {
  const found: string[] = [];
  const bpm = prompt.match(/\b\d{2,3}\s?bpm\b/i);
  if (bpm) found.push(`темп в тексте («${bpm[0]}») — перенесите в поле bpm`);
  const key = prompt.match(/\b[A-G](?:\s?(?:#|b|sharp|flat))?\s+(?:major|minor)\b/);
  if (key) found.push(`тональность в тексте («${key[0]}») — перенесите в поле keyscale`);
  const ts = prompt.match(/\b[2-9]\s?\/\s?[248]\b/);
  if (ts) found.push(`размер в тексте («${ts[0]}») — перенесите в поле размера`);
  return found;
}

export function BgmList({ projectId }: { projectId: string }) {
  const [blocks, setBlocks] = useState<NarrativeBlock[] | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [opts,   setOpts]   = useState<MetaOptions | null>(null);

  const refresh = useCallback(() => {
    api.listBlocks(projectId)
      .then(setBlocks)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Option lists never change at runtime — fetch once, not on the 5s poll.
  useEffect(() => {
    api.bgmMetaOptions()
      .then(setOpts)
      .catch(() => { /* selects fall back to a free-text input */ });
  }, []);

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!blocks) return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Фоновая музыка · ACE-Step</h2>
        <div className="text-xs text-zinc-500">
          {blocks.length} блоков
        </div>
      </div>

      {blocks.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          Блоков ещё нет.
        </div>
      )}

      <div className="space-y-6">
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} opts={opts} onChanged={refresh} />
        ))}
      </div>
    </main>
  );
}

// ─── Shared meta editor ─────────────────────────────────────────────────────
//
// One row of tempo / key / metre controls, used at both the act level and the
// tile level. An empty value means "not set": at act level that leaves the
// workflow template's own default (120 / A minor / 4) in place, at tile level it
// inherits the act. Nothing is defaulted eagerly, so an act nobody has tuned
// keeps rendering exactly as it did before these fields existed.

type MetaDraft = { bpm: string; keyscale: string; timesignature: string };

/** The node's `timesignature` combo holds a bare numerator; these are the metres
 *  those numerators mean. '4' is by far the most stable. */
const TIMESIG_LABELS: Record<string, string> = { '2': '2/4', '3': '3/4', '4': '4/4', '6': '6/8' };

function metaDraftFrom(src: { bpm?: number | null; keyscale?: string | null; timesignature?: string | null }): MetaDraft {
  return {
    bpm:           src.bpm == null ? '' : String(src.bpm),
    keyscale:      src.keyscale ?? '',
    timesignature: src.timesignature ?? '',
  };
}

/** Draft → PATCH body. Empty string becomes null (explicitly clears the field). */
function metaBodyFrom(d: MetaDraft) {
  const n = Number(d.bpm);
  return {
    bpm:           d.bpm.trim() === '' || !Number.isFinite(n) ? null : Math.round(n),
    keyscale:      d.keyscale      === '' ? null : d.keyscale,
    timesignature: d.timesignature === '' ? null : d.timesignature,
  };
}

function metaDraftEquals(a: MetaDraft, b: MetaDraft): boolean {
  return a.bpm === b.bpm && a.keyscale === b.keyscale && a.timesignature === b.timesignature;
}

function MetaFields({
  draft,
  opts,
  disabled,
  emptyLabel,
  onChange,
}: {
  draft:      MetaDraft;
  opts:       MetaOptions | null;
  disabled:   boolean;
  /** Label for the "not set" option — "шаблон (120)" on an act, "как в акте" on a tile. */
  emptyLabel: string;
  onChange:   (next: MetaDraft) => void;
}) {
  const sel = 'text-xs bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono disabled:text-zinc-600';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5" title="Темп. ACE-Step считает его опорной точкой, итог гуляет на ±2–4. Медленно 60–80, средне 90–120, быстро 130–180.">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">bpm</span>
        <input
          type="number"
          min={opts?.bpm.min ?? 10}
          max={opts?.bpm.max ?? 300}
          value={draft.bpm}
          disabled={disabled}
          placeholder={emptyLabel}
          onChange={(e) => onChange({ ...draft, bpm: e.target.value })}
          className={`w-24 text-center ${sel}`}
        />
      </label>

      <label className="flex items-center gap-1.5" title="Тональность. Значения — ровно из combo-списка ноды: «A minor», «Eb major». «Am» нода не примет.">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">key</span>
        <select
          value={draft.keyscale}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, keyscale: e.target.value })}
          className={sel}
        >
          <option value="">{emptyLabel}</option>
          {(opts?.keyscales ?? []).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
          {/* An existing value the option list doesn't contain (older row, hand-edited
              SQL) must stay visible, or opening this select would silently drop it. */}
          {draft.keyscale !== '' && !(opts?.keyscales ?? []).includes(draft.keyscale) && (
            <option value={draft.keyscale}>{draft.keyscale} (не из списка!)</option>
          )}
        </select>
      </label>

      <label className="flex items-center gap-1.5" title="Размер. Нода принимает только цифру: 2, 3, 4, 6. «4/4» — невалидное значение combo.">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">размер</span>
        <select
          value={draft.timesignature}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, timesignature: e.target.value })}
          className={sel}
        >
          <option value="">{emptyLabel}</option>
          {(opts?.timesignatures ?? ['2', '3', '4', '6']).map((t) => (
            // The node stores a bare numerator; show the metre it stands for.
            <option key={t} value={t}>{TIMESIG_LABELS[t] ?? t}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ─── Block card ─────────────────────────────────────────────────────────────

function BlockCard({ block, opts, onChanged }: { block: NarrativeBlock; opts: MetaOptions | null; onChanged: () => void }) {
  const segments  = block.segments ?? [];
  const mains     = segments.filter((s) => !s.spare);
  const spares    = segments.filter((s) =>  s.spare);
  const target    = block.targetSeconds ?? 0;
  // Main tiles needed to cover the act: ceil(actLength / 150). The fill action
  // tops up to this + 2 spare tiles.
  const wantMain  = target > 0 ? Math.max(1, Math.ceil(target / 150)) : 0;
  const tiled     = wantMain > 0 && mains.length >= wantMain && spares.length >= 2;

  const [prompt, setPrompt]     = useState(block.moodPrompt ?? '');
  const [metas,  setMetas]      = useState<MetaDraft>(() => metaDraftFrom(block));
  const [dirty,  setDirty]      = useState(false);
  const [busy,   setBusy]       = useState(false);

  // Resync editor when the block prop changes (e.g. server refresh changed moodPrompt)
  useEffect(() => {
    if (!dirty) setPrompt(block.moodPrompt ?? '');
  }, [block.moodPrompt, dirty]);
  useEffect(() => {
    if (!dirty) setMetas(metaDraftFrom(block));
  }, [block.bpm, block.keyscale, block.timesignature, dirty]);

  const conflicts = captionMetaConflicts(prompt);

  /** Caption and metas go in ONE patch — they are two halves of the same prompt
   *  and saving them separately would leave the model contradicting itself for
   *  as long as the user takes to press the second button. */
  const savePrompt = async () => {
    setBusy(true);
    try {
      await api.updateBlock(block.id, { moodPrompt: prompt, ...metaBodyFrom(metas) });
      setDirty(false);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const fill = async () => {
    setBusy(true);
    try {
      await api.fillBlock(block.id);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const statusBadge = (() => {
    const base = 'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border';
    if (block.status === 'filled')  return <span className={`${base} text-emerald-300 border-emerald-700 bg-emerald-900/30`}>filled</span>;
    if (block.status === 'manual')  return <span className={`${base} text-zinc-300 border-zinc-700 bg-zinc-800/30`}>manual</span>;
    return <span className={`${base} text-amber-300 border-amber-700 bg-amber-900/30`}>filling</span>;
  })();

  return (
    <article className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          <span className="text-zinc-500 text-xs font-mono mr-2">#{block.sortOrder}</span>
          {block.title ?? block.slug}
          <span className="text-zinc-500 text-xs font-mono ml-2">({block.slug})</span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          {statusBadge}
          <span className="text-zinc-500 font-mono">
            акт ~{target}s
          </span>
          <span className="text-zinc-500">
            {mains.length}/{wantMain} осн + {spares.length} зап
          </span>
        </div>
      </header>

      <div className="px-5 py-4 space-y-4">
        {/* Mood prompt editor */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Mood-промпт (английский, ACE-Step теги) — жанр, ударные, инструменты, настроение, продакшн
          </label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setDirty(true); }}
            rows={3}
            className="w-full font-mono text-xs bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-200 focus:outline-none focus:border-zinc-600"
            placeholder="neoclassical chamber lament, no drums, solo cello, sparse felt piano, grief with the ceremony done properly, hall reverb, instrumental, no vocals"
          />

          {/* Tempo / key / metre. The tokenizer hands these to the model as a
              separate "# Metas" block, so they belong here and NOT in the
              caption above — see Skill(gen-studio-acestep). */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <MetaFields
              draft={metas}
              opts={opts}
              disabled={busy}
              emptyLabel="шаблон"
              onChange={(next) => { setMetas(next); setDirty(true); }}
            />
            <span className="text-[10px] text-zinc-600">
              «шаблон» = как раньше (120 · A minor · 4/4)
            </span>
          </div>

          {conflicts.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-300/90 bg-amber-950/30 border border-amber-900/60 rounded px-2 py-1.5 space-y-0.5">
              {conflicts.map((c) => <div key={c}>⚠ {c}</div>)}
              <div className="text-amber-200/60">
                Темп и тональность ACE-Step получает отдельным блоком — цифра в тексте спорит с ним, и ритм выходит ничей.
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[10px] text-zinc-500">
              {dirty ? 'не сохранено' : ' '}
            </div>
            <button
              onClick={savePrompt}
              disabled={!dirty || busy}
              className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 py-1 rounded"
            >
              сохранить
            </button>
          </div>
        </div>

        {/* Fill controls — auto-tiles the act into 150s tiles + 2 spares. */}
        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Плитки 150с × {wantMain || '?'} + 2 запасных
          </span>
          <button
            onClick={fill}
            disabled={busy || block.status === 'manual'}
            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 py-1 rounded ml-2"
          >
            {tiled ? 'пересчитать' : 'заполнить'}
          </button>
          {tiled && <span className="text-[10px] text-emerald-400">акт покрыт</span>}
        </div>

        {/* Segments */}
        {segments.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            {segments.map((seg) => (
              <SegmentRow
                key={seg.id}
                segment={seg}
                block={block}
                opts={opts}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Segment row ────────────────────────────────────────────────────────────

function SegmentRow({
  segment,
  block,
  opts,
  onChanged,
}: {
  segment:   MusicSegment;
  /** Parent act — supplies the inherited caption and the inherited metas. */
  block:     NarrativeBlock;
  opts:      MetaOptions | null;
  onChanged: () => void;
}) {
  const blockMoodPrompt = block.moodPrompt;
  const jobs = segment.jobs ?? [];
  const approved   = jobs.find((j) => j.id === segment.approvedJobId);
  const inFlight   = jobs.find((j) => j.status === 'pending' || j.status === 'running');
  const completed  = jobs.filter((j) => j.status === 'completed');

  // Selected take (defaults to approved → newest completed → none).
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    approved?.id ?? completed[0]?.id ?? null,
  );
  useEffect(() => {
    // Keep selection in sync when the data refreshes — prefer approved.
    if (approved && selectedJobId !== approved.id) setSelectedJobId(approved.id);
    else if (!selectedJobId && completed[0]) setSelectedJobId(completed[0].id);
  }, [approved?.id, completed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null;

  const [override,    setOverride]   = useState(segment.prompt ?? '');
  const [segMetas,    setSegMetas]   = useState<MetaDraft>(() => metaDraftFrom(segment));
  const [dirty,       setDirty]      = useState(false);
  const [busy,        setBusy]       = useState(false);
  // Per-render duration override. Defaults to segment.durationSec; user can
  // bump up/down before clicking render. Buffer as string (same reason as
  // the chunkSeconds input on the block: clamping onChange on type=number
  // fights mid-typing values).
  const [secStr, setSecStr] = useState(String(segment.durationSec));
  useEffect(() => { setSecStr(String(segment.durationSec)); }, [segment.durationSec]);
  useEffect(() => { if (!dirty) setOverride(segment.prompt ?? ''); }, [segment.prompt, dirty]);
  useEffect(() => {
    if (!dirty) setSegMetas(metaDraftFrom(segment));
  }, [segment.bpm, segment.keyscale, segment.timesignature, dirty]);

  /**
   * Persist the tile's own caption + metas. An empty caption saves as null,
   * which is meaningfully different from an empty string: null inherits the
   * act's mood prompt, "" would render on the generic fallback tags.
   */
  const savePrompt = async () => {
    setBusy(true);
    try {
      const trimmed = override.trim();
      await api.updateSegment(segment.id, {
        prompt: trimmed === '' ? null : trimmed,
        ...metaBodyFrom(segMetas),
      });
      setDirty(false);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const queueRender = async () => {
    const raw = Number(secStr);
    const durationSec = Number.isFinite(raw) && raw > 0
      ? Math.max(10, Math.min(240, Math.round(raw)))
      : segment.durationSec;
    setBusy(true);
    try {
      await api.startBgmRender(segment.id, { count: 1, durationSec });
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const approve = async (jobId: string) => {
    setBusy(true);
    try {
      await api.approveBgmJob(segment.id, jobId);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const unapprove = async () => {
    setBusy(true);
    try {
      await api.unapproveBgmJob(segment.id);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Удалить эту версию (DB row + flac)?')) return;
    setBusy(true);
    try {
      await api.deleteBgmJob(jobId);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const deleteSeg = async () => {
    if (!confirm('Удалить сегмент целиком (со всеми версиями)?')) return;
    setBusy(true);
    try {
      await api.deleteSegment(segment.id);
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const effectivePrompt = (segment.prompt ?? blockMoodPrompt ?? '').trim();

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-mono">#{segment.sortOrder}</span>
          <span className="text-zinc-300">{segment.durationSec}s</span>
          {segment.spare && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border text-sky-300 border-sky-800 bg-sky-900/30">
              запас
            </span>
          )}
          {approved && <span className="text-emerald-400">✓ approved</span>}
          {inFlight && (
            <span className="text-amber-300">
              {inFlight.status === 'running' ? '⚙ running' : '⏳ pending'}
            </span>
          )}
          {!approved && !inFlight && completed.length > 0 && (
            <span className="text-zinc-500">{completed.length} take(s) — нужна аппрува</span>
          )}
          {!approved && !inFlight && completed.length === 0 && (
            <span className="text-zinc-500">ничего не рендерено</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={240}
            value={secStr}
            onChange={(e) => setSecStr(e.target.value)}
            onBlur={() => {
              const n = Number(secStr);
              if (!Number.isFinite(n) || n <= 0) setSecStr(String(segment.durationSec));
              else setSecStr(String(Math.max(10, Math.min(240, Math.round(n)))));
            }}
            disabled={busy}
            className="w-14 text-xs bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center"
            title="Сколько секунд генерировать (10–240). Ровно это число — без авто-надбавки."
          />
          <span className="text-[10px] text-zinc-500">сек</span>
          <button
            onClick={queueRender}
            disabled={busy}
            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-2 py-0.5 rounded"
            title="Поставить ACE-Step take в очередь с указанной длительностью"
          >
            ▶ render
          </button>
          <button
            onClick={deleteSeg}
            disabled={busy}
            className="text-xs text-zinc-400 hover:text-red-400 disabled:text-zinc-700 px-1"
            title="Удалить сегмент"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Per-tile override: caption + metas. Always available now that the
          backend exposes PATCH /bgm/segments/:id — it used to be visible only
          when a prompt already existed, which made an override impossible to
          author in the first place. */}
      <details className="mt-2 text-xs" open={dirty}>
        <summary className="cursor-pointer text-zinc-500">
          override плитки
          {segment.prompt !== null && <span className="text-amber-400/80 ml-1">· свой промпт</span>}
          {(segment.bpm != null || segment.keyscale || segment.timesignature) && (
            <span className="text-amber-400/80 ml-1">· свой темп/ключ</span>
          )}
        </summary>
        <textarea
          value={override}
          onChange={(e) => { setOverride(e.target.value); setDirty(true); }}
          rows={2}
          placeholder={`пусто = как в акте: ${(blockMoodPrompt ?? '').slice(0, 80) || '(у акта тоже пусто)'}`}
          className="mt-1 w-full font-mono text-xs bg-zinc-900 border border-zinc-800 rounded p-2 text-zinc-300"
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <MetaFields
            draft={segMetas}
            opts={opts}
            disabled={busy}
            emptyLabel="как в акте"
            onChange={(next) => { setSegMetas(next); setDirty(true); }}
          />
          <button
            onClick={savePrompt}
            disabled={!dirty || busy}
            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-2 py-0.5 rounded"
          >
            сохранить
          </button>
        </div>
        {captionMetaConflicts(override).map((c) => (
          <div key={c} className="mt-1 text-[10px] text-amber-300/90">⚠ {c}</div>
        ))}
      </details>

      {/* Player + take selector */}
      {completed.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className="text-zinc-500">Версия:</span>
            <select
              value={selectedJobId ?? ''}
              onChange={(e) => setSelectedJobId(e.target.value || null)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 font-mono"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.id.slice(0, 8)} · {j.status}
                  {j.id === segment.approvedJobId ? ' · ✓' : ''}
                  {j.params?.seed !== undefined ? ` · seed ${j.params.seed}` : ''}
                </option>
              ))}
            </select>
            {selected && selected.status === 'completed' && (
              <>
                {selected.id !== segment.approvedJobId ? (
                  <button
                    onClick={() => approve(selected.id)}
                    disabled={busy}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-0.5 rounded"
                  >
                    апрувнуть
                  </button>
                ) : (
                  <button
                    onClick={unapprove}
                    disabled={busy}
                    className="text-xs text-zinc-400 hover:text-amber-400"
                  >
                    снять апрув
                  </button>
                )}
                <button
                  onClick={() => deleteJob(selected.id)}
                  disabled={busy}
                  className="text-xs text-zinc-400 hover:text-red-400"
                >
                  удалить версию
                </button>
              </>
            )}
          </div>
          {selected && selected.status === 'completed' && (
            <AudioPreview jobId={selected.id} />
          )}
        </div>
      )}

      {inFlight?.errorMessage && (
        <div className="mt-2 text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
          {inFlight.errorMessage}
        </div>
      )}
      {jobs.filter((j) => j.status === 'failed').slice(0, 1).map((j) => (
        <div key={j.id} className="mt-2 text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
          {j.errorMessage ?? 'failed (no message)'}
        </div>
      ))}

      {/* Effective prompt preview — caption AND metas, laid out the way the
          ACE-Step tokenizer actually hands them to the model, so a contradiction
          between the two is visible at a glance. */}
      <details className="mt-2 text-[10px] text-zinc-600">
        <summary className="cursor-pointer">эффективный промпт</summary>
        <div className="mt-1 font-mono text-zinc-500 whitespace-pre-wrap">
          {'# Caption\n'}
          {effectivePrompt}
          {'\n\n# Metas\n'}
          {`- bpm: ${segment.bpm ?? block.bpm ?? '120 (шаблон)'}\n`}
          {`- timesignature: ${segment.timesignature ?? block.timesignature ?? '4 (шаблон)'}\n`}
          {`- keyscale: ${segment.keyscale ?? block.keyscale ?? 'A minor (шаблон)'}\n`}
          {`- duration: ${segment.durationSec} seconds`}
        </div>
      </details>
    </div>
  );
}

// ─── Audio preview with bitrate readout ─────────────────────────────────────
//
// Native <audio controls> needs the server to honour HTTP Range + return
// Content-Length to expose a working seek slider. Backend was fixed at the
// same time as this component (bgm.controller.ts file()).
//
// `preload="metadata"` is required: with "none" the browser doesn't fetch
// duration until the user clicks play, and the timeline scrubber stays inert
// until then. "metadata" only pulls the flac header (~kilobytes), no audio
// frames — cheap enough to do upfront and unblocks seeking immediately.

function AudioPreview({ jobId }: { jobId: string }) {
  const [meta, setMeta] = useState<{ bytes: number; durationSec: number; bitrateKbps: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    api.getBgmJobMeta(jobId)
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { /* meta is purely informational — silent fail */ });
    return () => { cancelled = true; };
  }, [jobId]);

  // Apply the 0.2 default ONCE per audio element. A callback ref like
  // `ref={(el) => { el.volume = 0.2 }}` fires on every render and silently
  // clobbers the user's manual slider position every poll cycle (the parent
  // BgmList refreshes every 5s) — felt like the volume kept stepping down.
  // useEffect runs only on mount of this jobId.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 0.2;
  }, [jobId]);

  const bytesMb = meta ? (meta.bytes / (1024 * 1024)).toFixed(1) : null;

  return (
    <div className="mt-1">
      <audio
        key={jobId}
        controls
        src={api.bgmJobFileUrl(jobId)}
        className="w-full"
        preload="metadata"
        ref={audioRef}
      />
      <div className="mt-0.5 text-[10px] text-zinc-500 font-mono">
        {meta
          ? `${meta.bitrateKbps} kbps · ${meta.durationSec.toFixed(1)}s · ${bytesMb} MB`
          : '…'}
      </div>
    </div>
  );
}
