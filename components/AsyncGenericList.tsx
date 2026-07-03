'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface Paginated<T> { rows: T[]; total: number }

interface AsyncGenericListProps<T> {
  /** Fetch one page. MUST be stable (wrap in useCallback) — its identity is the
   *  reset key: when it changes the list reloads from skip=0 (use that for
   *  filters / search / route changes). */
  fetchPage: (skip: number, take: number) => Promise<Paginated<T>>;
  renderItem: (item: T) => React.ReactNode;
  keyOf: (item: T, index: number) => React.Key;
  /** Page size. */
  take?: number;
  /** Literal Tailwind grid classes (kept literal so JIT doesn't purge them). */
  gridClassName?: string;
  /** Optional skeleton shown per expected item while a page is loading. */
  skeleton?: React.ReactNode;
  loadingText?: string;
  noMoreText?: string;
  emptyText?: string;
}

/**
 * Generic infinite-scroll list backed by server pagination ({ rows, total }).
 * Loads the first page on mount, then reveals the next page as a sentinel near
 * the bottom enters view (pre-loaded ~600px early). Self-accumulating — a page
 * only needs to provide `fetchPage` + `renderItem`. Reused across list pages.
 *
 * `renderItem` is rendered inside a keyed Fragment (not a wrapper div), so it
 * may return one OR several grid children (e.g. one card per character-profile).
 */
export function AsyncGenericList<T>({
  fetchPage,
  renderItem,
  keyOf,
  take = 24,
  gridClassName = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
  skeleton,
  loadingText = 'Загрузка…',
  noMoreText = 'Это всё',
  emptyText = 'Пусто',
}: AsyncGenericListProps<T>) {
  const [rows, setRows]       = useState<T[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const busy        = useRef(false);
  const skipRef     = useRef(0);

  const loadMore = useCallback(async () => {
    if (busy.current || done) return;
    busy.current = true; setLoading(true); setError(null);
    try {
      const res = await fetchPage(skipRef.current, take);
      skipRef.current += res.rows.length;
      setTotal(res.total);
      setRows((prev) => [...prev, ...res.rows]);
      if (res.rows.length === 0 || skipRef.current >= res.total) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false; setLoading(false);
    }
  }, [fetchPage, take, done]);

  // (Re)initialise from scratch whenever the fetcher identity changes.
  useEffect(() => {
    let cancelled = false;
    skipRef.current = 0; busy.current = true;
    setRows([]); setTotal(0); setDone(false); setError(null); setLoading(true);
    (async () => {
      try {
        const res = await fetchPage(0, take);
        if (cancelled) return;
        skipRef.current = res.rows.length;
        setRows(res.rows); setTotal(res.total);
        if (res.rows.length === 0 || res.rows.length >= res.total) setDone(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) { busy.current = false; setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [fetchPage, take]);

  // Observe the bottom sentinel → pull the next page before it's fully in view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) void loadMore(); },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, done]);

  return (
    <>
      <div className={gridClassName}>
        {rows.map((item, i) => (
          <React.Fragment key={keyOf(item, i)}>{renderItem(item)}</React.Fragment>
        ))}
        {loading && skeleton && Array.from({ length: take }).map((_, i) => (
          <React.Fragment key={`sk-${i}`}>{skeleton}</React.Fragment>
        ))}
      </div>

      {error && (
        <div className="mt-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>
      )}

      {/* Sentinel: present whenever more pages remain. */}
      {!done && !error && (
        <div ref={sentinelRef} className="h-12 flex items-center justify-center gap-2 text-zinc-600 text-xs mt-6">
          <span className="inline-block h-4 w-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          <span>{loadingText} {total > 0 ? `(${rows.length} из ${total})` : ''}</span>
        </div>
      )}
      {done && rows.length > 0 && (
        <div className="text-center py-4 text-xs text-zinc-600 italic">{noMoreText} — {rows.length} из {total}</div>
      )}
      {done && rows.length === 0 && !loading && (
        <div className="text-center py-8 text-zinc-500 text-sm">{emptyText}</div>
      )}
    </>
  );
}
