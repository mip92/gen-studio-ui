'use client';

/**
 * Detail page for ONE music track (NarrativeBlock) — /projects/<id>/bgm/<slug>.
 * The queue's «Цель» column deep-links here (optionally with a #seg-<id> hash
 * pointing at the exact tile a render job produced), and each track title on
 * the all-tracks page links here too.
 *
 * The route param is the block SLUG, not its UUID: the queue ledger snapshots
 * only the slug, so the slug is the one identifier every link source has.
 * Slugs are unique within a project, which is exactly the scope of this page.
 *
 * Same 5s refresh cadence as BgmList — matches the backend queue tick.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, NarrativeBlock } from '../lib/api';
import { BlockCard, MetaOptions } from './BgmList';

export function BgmBlockDetail({ projectId, slug }: { projectId: string; slug: string }) {
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

  useEffect(() => {
    api.bgmMetaOptions()
      .then(setOpts)
      .catch(() => { /* selects fall back to a free-text input */ });
  }, []);

  // #seg-<uuid> hash from a queue deep-link. Read once on mount: the hash never
  // changes without a navigation, and re-reading it on poll would re-scroll.
  const [highlightSegmentId, setHighlightSegmentId] = useState<string | null>(null);
  useEffect(() => {
    const m = window.location.hash.match(/^#seg-(.+)$/);
    if (m) setHighlightSegmentId(m[1]);
  }, []);

  // The tile is rendered asynchronously, so the browser's native hash scroll
  // fires before the element exists. Scroll manually, once, after first render.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !highlightSegmentId || !blocks) return;
    const el = document.getElementById(`seg-${highlightSegmentId}`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      scrolled.current = true;
    }
  }, [blocks, highlightSegmentId]);

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!blocks) return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;

  const block = blocks.find((b) => b.slug === slug);

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">
          Трек · <span className="font-mono normal-case text-zinc-300">{slug}</span>
        </h2>
        <Link
          href={`/projects/${projectId}/bgm`}
          className="text-xs text-zinc-400 underline-offset-2 hover:underline hover:text-white"
        >
          ← вся музыка проекта
        </Link>
      </div>

      {!block && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          Трека «{slug}» в этом проекте нет — возможно, акт переименовали или удалили.
        </div>
      )}

      {block && (
        <BlockCard
          block={block}
          opts={opts}
          onChanged={refresh}
          linkTitle={false}
          highlightSegmentId={highlightSegmentId}
        />
      )}
    </main>
  );
}
