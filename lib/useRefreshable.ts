'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run a fetch on mount, on demand, and never on a timer.
 *
 * There is NO interval in here and none should be added. Recurring work is what
 * this codebase moved away from — see lib/liveEvents.tsx. Pair this with
 * `useLiveEvents` (push while the tab is live) and RefreshControl (the manual
 * button); between them a page is fresh without ever polling.
 *
 * What it actually buys over a bare `useEffect(fetch)`:
 *
 *  - **In-flight guard.** The backend blocks on HTTP for minutes at a time
 *    during TTS synthesis. Without a guard, a wake burst or a burst of deltas
 *    stacks identical requests behind that block and dumps them all at once when
 *    it clears. A second call while one is in flight is dropped, not queued.
 *  - **Staleness guard.** A resolving fetch from a previous id/params generation
 *    is discarded instead of writing state for the thing the user already
 *    navigated away from. No AbortController: aborting closes the browser's
 *    wait, it cannot cancel work already occupying a blocked Nest handler, so it
 *    would buy nothing here while costing a signal param on ~150 api methods.
 *  - **`lastUpdatedAt`**, which RefreshControl needs to render «данные от HH:MM».
 */
export interface UseRefreshableResult {
  /** A fetch is in flight (drives the button's disabled/… state). */
  refreshing: boolean;
  error: string | null;
  /** ms epoch of the last SUCCESSFUL fetch; null until one lands. */
  lastUpdatedAt: number | null;
  /** Safe to call at any time, from anywhere, as often as you like. */
  refresh: () => void;
}

export function useRefreshable(
  /** Does the work AND commits it (calls the component's own setState). Must be
   *  memoized with useCallback — it is an effect dependency. */
  fetcher: () => Promise<unknown>,
  opts: {
    /** Skip fetching entirely (e.g. an id hasn't resolved yet). Default true. */
    enabled?: boolean;
  } = {},
): UseRefreshableResult {
  const { enabled = true } = opts;

  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const inFlight   = useRef(false);
  const generation = useRef(0);

  // Bump the generation whenever the fetcher identity changes (new id/params) or
  // we unmount, so anything still resolving from before is ignored on arrival.
  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; };
  }, [fetcher]);

  const refresh = useCallback(() => {
    if (!enabled || inFlight.current) return;
    const mine = generation.current;
    inFlight.current = true;
    setRefreshing(true);
    void (async () => {
      try {
        await fetcher();
        if (generation.current !== mine) return;
        setLastUpdatedAt(Date.now());
        setError(null);
      } catch (e) {
        if (generation.current !== mine) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
        if (generation.current === mine) setRefreshing(false);
      }
    })();
  }, [fetcher, enabled]);

  // Initial load, and a reload whenever the fetcher's identity changes.
  useEffect(() => { refresh(); }, [refresh]);

  return { refreshing, error, lastUpdatedAt, refresh };
}
