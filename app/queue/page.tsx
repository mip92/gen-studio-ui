'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { api, QueueSnapshot, QueueRow, QueueJobType } from '../../lib/api';

const POLL_MS = 3000;

// Per-project lookup so queue rows can deep-link to character/shot/scene pages.
// Backend exposes only codes (characterCode, profileCode, shotCode), so we
// resolve them to ids by fetching characters + scenes once per project slug.
type ProjectLinks = {
  // characterCode → { characterId, profiles: profileCode → profileId }
  chars: Map<string, { characterId: string; profiles: Map<string, string> }>;
  // shotCode → { shotId, sceneKey }
  shots: Map<string, { shotId: string; sceneKey: string }>;
};

export default function QueuePage() {
  const [snap, setSnap]     = useState<QueueSnapshot | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);
  const [links, setLinks]   = useState<Record<string, ProjectLinks>>({});
  const inflightSlugs       = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const s = await api.pipelineQueue();
      setSnap(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Whenever a new project slug appears in the queue, fetch its characters+scenes
  // once to build the code→id lookup tables. Cached for the lifetime of the page.
  useEffect(() => {
    if (!snap) return;
    const slugs = new Set<string>();
    for (const r of [...snap.active, ...snap.pending, ...snap.recent]) slugs.add(r.projectSlug);

    for (const slug of slugs) {
      if (links[slug] || inflightSlugs.current.has(slug)) continue;
      inflightSlugs.current.add(slug);
      void Promise.all([api.listCharacters(slug), api.listScenes(slug)])
        .then(([chars, scenesRes]) => {
          const charMap: ProjectLinks['chars'] = new Map();
          for (const c of chars) {
            const profileMap = new Map<string, string>();
            for (const p of c.profiles) profileMap.set(p.profileCode, p.id);
            charMap.set(c.code, { characterId: c.id, profiles: profileMap });
          }
          const shotMap: ProjectLinks['shots'] = new Map();
          for (const s of scenesRes.scenes) {
            for (const sh of s.shots) shotMap.set(sh.shotCode, { shotId: sh.id, sceneKey: s.sceneKey });
          }
          setLinks((prev) => ({ ...prev, [slug]: { chars: charMap, shots: shotMap } }));
        })
        .catch(() => { /* leave links unset — row stays plain text */ })
        .finally(() => { inflightSlugs.current.delete(slug); });
    }
  }, [snap, links]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const move = async (type: QueueJobType, id: string, direction: 'up' | 'down') => {
    setBusy(`${type}:${id}:${direction}`);
    try { await api.pipelineMove(type, id, direction); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  const cancel = async (type: QueueJobType, id: string) => {
    if (!confirm(`Cancel ${type} job ${id.slice(0, 8)}…?`)) return;
    setBusy(`${type}:${id}:cancel`);
    try { await api.pipelineCancel(type, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally   { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Pipeline queue</h1>
            <p className="text-zinc-500 text-xs">Unified GPU queue · training + dataset + scene + video · auto-poll {POLL_MS}ms</p>
          </div>
          <Link href="/" className="text-zinc-400 hover:text-zinc-200 text-sm">← Projects</Link>
        </div>
      </header>

      <main className="p-8 max-w-7xl mx-auto space-y-8">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-4">
            <p className="text-red-200 font-mono text-sm">{error}</p>
          </div>
        )}

        {!snap && !error && <p className="text-zinc-500">Loading…</p>}

        {snap && (
          <>
            <Section title="Active" rows={snap.active} hint="Currently running on GPU. Cancel kills the subprocess (or marks failed if zombie).">
              {snap.active.length === 0 && <Empty>nothing running</Empty>}
              {snap.active.map((r) => (
                <Row key={`${r.type}-${r.id}`} row={r} pl={links[r.projectSlug]}
                     right={<CancelBtn busy={busy === `${r.type}:${r.id}:cancel`} onClick={() => cancel(r.type, r.id)} />} />
              ))}
            </Section>

            <Section
              title="Pending"
              rows={snap.pending}
              hint="Will run sequentially in this order. Use ↑ ↓ to reorder."
            >
              {snap.pending.length === 0 && <Empty>queue is empty</Empty>}
              {snap.pending.map((r, idx) => (
                <Row key={`${r.type}-${r.id}`} row={r} pl={links[r.projectSlug]} left={
                  <div className="flex flex-col -mr-1">
                    <button
                      disabled={idx === 0 || !!busy}
                      onClick={() => move(r.type, r.id, 'up')}
                      className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 px-1 leading-none"
                      title="Move up">↑</button>
                    <button
                      disabled={idx === snap.pending.length - 1 || !!busy}
                      onClick={() => move(r.type, r.id, 'down')}
                      className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 px-1 leading-none"
                      title="Move down">↓</button>
                  </div>
                } right={<CancelBtn busy={busy === `${r.type}:${r.id}:cancel`} onClick={() => cancel(r.type, r.id)} />} />
              ))}
            </Section>

            <Section title="Recent (last 50)" rows={snap.recent} hint="Completed / failed / cancelled in this session.">
              {snap.recent.length === 0 && <Empty>no history</Empty>}
              {snap.recent.map((r) => (
                <Row key={`${r.type}-${r.id}`} row={r} pl={links[r.projectSlug]} />
              ))}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, rows, hint, children }: {
  title: string; rows: QueueRow[]; hint?: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">{title}</h2>
        <span className="text-zinc-600 text-xs">{rows.length}</span>
        {hint && <span className="text-zinc-600 text-xs ml-auto">{hint}</span>}
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded divide-y divide-zinc-800">
        {children}
      </div>
    </section>
  );
}

function Row({ row, pl, left, right }: {
  row:    QueueRow;
  pl?:    ProjectLinks;
  left?:  React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2 flex items-center gap-3">
      {left}
      <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${typeBadge(row.type)}`}>
        {row.type}
      </span>
      <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${statusBadge(row.status)}`}>
        {row.status}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono truncate">
          <span className="text-zinc-500">{row.projectSlug} / </span>
          {renderRowTargets(row, pl)}
          {row.triggerToken && <span className="text-zinc-600 ml-2">→ {row.triggerToken}</span>}
        </div>
        <div className="text-xs text-zinc-500">
          queued {fmt(row.queuedAt)}
          {row.startedAt   && <> · started {fmt(row.startedAt)}</>}
          {row.completedAt && <> · done {fmt(row.completedAt)}</>}
        </div>
        {row.errorMessage && (
          <div className="text-xs text-red-400 truncate" title={row.errorMessage}>
            ⚠ {row.errorMessage}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

/**
 * Resolve the row's targets (character + profile, or shot + scene) to links
 * when the per-project lookup is loaded. Falls back to plain text — the queue
 * still renders before lookups arrive (or if the project has been deleted).
 *
 * Note: for scene rows the backend stuffs shotCode into `profileCode` and the
 * scene title into `characterCode` (see pipeline.controller.ts:226-240).
 */
function renderRowTargets(row: QueueRow, pl?: ProjectLinks): React.ReactNode {
  const cls = 'underline-offset-2 hover:underline hover:text-white';

  if (row.type === 'scene' || row.type === 'video' || row.type === 'video_upscale') {
    // For video_upscale the profileCode includes a "↑FHD" suffix — strip for lookup.
    const lookupCode = row.profileCode.replace(/\s*↑FHD\s*$/, '');
    const shot  = pl?.shots.get(lookupCode);
    const slug  = row.projectSlug;
    const sceneNode = shot
      ? <Link href={`/projects/${slug}/scenes#${shot.sceneKey}`} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
      : <span className="text-zinc-300">{row.characterCode}</span>;
    // For video/video_upscale the id IS the videoRender id — link to the video detail page.
    const shotNode = shot
      ? (row.type === 'video' || row.type === 'video_upscale'
          ? <Link href={`/projects/${slug}/shots/${shot.shotId}/videos/${row.id}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
          : <Link href={`/projects/${slug}/shots/${shot.shotId}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>)
      : <span className="text-zinc-200">{row.profileCode}</span>;
    return <>{sceneNode}<span className="text-zinc-500"> · </span>{shotNode}</>;
  }

  const char = pl?.chars.get(row.characterCode);
  const profileId = char?.profiles.get(row.profileCode);
  const slug = row.projectSlug;
  const charNode = profileId
    ? <Link href={`/projects/${slug}/characters/${profileId}`} className={`text-zinc-300 ${cls}`}>{row.characterCode}</Link>
    : <span className="text-zinc-300">{row.characterCode}</span>;
  const profNode = profileId
    ? <Link href={`/projects/${slug}/characters/${profileId}`} className={`text-zinc-200 ${cls}`}>{row.profileCode}</Link>
    : <span className="text-zinc-200">{row.profileCode}</span>;
  return <>{charNode}<span className="text-zinc-500"> · </span>{profNode}</>;
}

function CancelBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-1 rounded disabled:opacity-50">
      {busy ? '…' : 'cancel'}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-zinc-600 text-sm italic">— {children} —</div>;
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const dt = now - d.getTime();
  // Negative dt = timestamp in "future" (server/client clock or TZ skew). Show
  // "just now" rather than the misleading "-1234s ago".
  if (dt < 0)             return 'just now';
  if (dt < 60_000)        return `${Math.floor(dt / 1000)}s ago`;
  if (dt < 3_600_000)     return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000)    return `${Math.floor(dt / 3_600_000)}h ago`;
  return d.toLocaleString();
}

function typeBadge(t: QueueJobType): string {
  if (t === 'training')      return 'bg-purple-950/40 text-purple-300 border-purple-900';
  if (t === 'dataset')       return 'bg-blue-950/40   text-blue-300   border-blue-900';
  if (t === 'scene')         return 'bg-amber-950/40  text-amber-300  border-amber-900';
  if (t === 'video')         return 'bg-rose-950/40   text-rose-300   border-rose-900';
  return                            'bg-emerald-950/40 text-emerald-300 border-emerald-900';
}

function statusBadge(s: string): string {
  switch (s) {
    case 'pending':    return 'bg-zinc-800 text-zinc-400';
    case 'blocked':    return 'bg-amber-950 text-amber-400';
    case 'running':
    case 'preparing':
    case 'captioning':
    case 'training':   return 'bg-emerald-950 text-emerald-300';
    case 'completed':  return 'bg-emerald-900/40 text-emerald-400';
    case 'failed':     return 'bg-red-950 text-red-400';
    case 'cancelled':  return 'bg-zinc-800 text-zinc-500';
    default:           return 'bg-zinc-800 text-zinc-400';
  }
}
