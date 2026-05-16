'use client';

import { useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const PREFIX = 'scrollRestore:';

interface ScrollState { y: number; targetId?: string; }

/**
 * Scroll-restoration for list pages.
 *
 * On mount, looks up a saved scroll position (by route or explicit scope) and
 * either scrolls the matching `[data-scroll-key="<id>"]` element into view OR
 * falls back to the previously-remembered window scroll Y.
 *
 * Returns `markBeforeNav(targetId?)` — call it from a row's onClick BEFORE the
 * navigation fires, so the next time the user lands here the scroll snaps back
 * to that row.
 */
export function useScrollRestore(scope?: string): (targetId?: string) => void {
  const pathname = usePathname();
  const key = `${PREFIX}${scope ?? pathname}`;

  useEffect(() => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    let state: ScrollState | null = null;
    try { state = JSON.parse(raw) as ScrollState; } catch { return; }
    if (!state) return;

    let attempts = 0;
    const tryRestore = () => {
      if (state!.targetId) {
        const el = document.querySelector(`[data-scroll-key="${CSS.escape(state!.targetId)}"]`) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: 'center' });
          sessionStorage.removeItem(key);
          return;
        }
        if (attempts++ < 10) {
          setTimeout(tryRestore, 60);
          return;
        }
      }
      window.scrollTo({ top: state!.y });
      sessionStorage.removeItem(key);
    };
    requestAnimationFrame(tryRestore);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useCallback((targetId?: string) => {
    const state: ScrollState = { y: window.scrollY, targetId };
    sessionStorage.setItem(key, JSON.stringify(state));
  }, [key]);
}
