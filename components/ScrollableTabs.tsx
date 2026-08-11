'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollableTab {
  href:   string;
  label:  string;
  active: boolean;
  /** Render as a non-clickable, greyed-out tab (e.g. Видео on a static shot). */
  disabled?: boolean;
  /** Optional tooltip, shown on hover — handy to explain why a tab is disabled. */
  title?: string;
}

/**
 * MUI-style horizontal tab strip with no visible scrollbar and chevron
 * buttons on the left/right that appear only when the row overflows. The
 * chevrons smooth-scroll by ~70% of the visible width. The active tab is
 * auto-scrolled into view on mount and whenever it changes.
 *
 * Visual stays consistent with the rest of the app: zinc-800 underline,
 * blue-500 indicator on active. No external libraries — Tailwind + a
 * scrollbar-hide helper in globals.css.
 */
export function ScrollableTabs({
  tabs, className = '',
}: {
  tabs: ScrollableTab[];
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef   = useRef<HTMLAnchorElement | null>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);

  const recomputeArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 1px tolerance so a perfectly-scrolled-to-end row doesn't flicker the arrow.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Wire scroll + resize listeners. ResizeObserver catches both viewport
  // resizes and font-load shifts that change scrollWidth.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    recomputeArrows();
    el.addEventListener('scroll', recomputeArrows, { passive: true });
    const ro = new ResizeObserver(recomputeArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', recomputeArrows);
      ro.disconnect();
    };
  }, [recomputeArrows, tabs.length]);

  // Centre the active tab on initial mount and on active-tab change.
  useEffect(() => {
    if (!activeRef.current || !scrollerRef.current) return;
    const el  = scrollerRef.current;
    const tab = activeRef.current;
    const tabCenter   = tab.offsetLeft + tab.offsetWidth / 2;
    const targetLeft  = tabCenter - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'auto' });
    recomputeArrows();
  }, [tabs, recomputeArrows]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.7), behavior: 'smooth' });
  };

  return (
    <div className={`relative border-b border-zinc-800 -mb-px ${className}`}>
      {/* Left chevron — fades in only when scrolled away from left edge */}
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        aria-label="Прокрутить вкладки влево"
        tabIndex={canLeft ? 0 : -1}
        className={`absolute left-0 top-0 bottom-0 z-10 px-1.5 flex items-center justify-center
          bg-gradient-to-r from-zinc-950 via-zinc-950/95 to-transparent
          text-zinc-400 hover:text-zinc-100 transition
          ${canLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronLeft />
      </button>

      <div
        ref={scrollerRef}
        role="tablist"
        // overflow-y-hidden is load-bearing: with only overflow-x-auto the CSS
        // spec computes overflow-y to auto too, and the tabs' border-b-2 -mb-px
        // make the content a couple px taller than the row — on touch that made
        // the strip vertically flingable with a rubber-band snap-back.
        className="flex overflow-x-auto overflow-y-hidden no-scrollbar"
      >
        {tabs.map((t) =>
          t.disabled ? (
            <span
              key={t.href}
              role="tab"
              aria-selected={false}
              aria-disabled
              title={t.title}
              className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap shrink-0 text-zinc-700 border-transparent cursor-not-allowed"
            >
              {t.label}
            </span>
          ) : (
            <Link
              key={t.href}
              href={t.href}
              ref={t.active ? activeRef : undefined}
              role="tab"
              aria-selected={t.active}
              title={t.title}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                t.active
                  ? 'text-blue-400 border-blue-500'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
              }`}
            >
              {t.label}
            </Link>
          ),
        )}
      </div>

      {/* Right chevron — fades in only when more tabs hide past the right edge */}
      <button
        type="button"
        onClick={() => scrollBy(1)}
        aria-label="Прокрутить вкладки вправо"
        tabIndex={canRight ? 0 : -1}
        className={`absolute right-0 top-0 bottom-0 z-10 px-1.5 flex items-center justify-center
          bg-gradient-to-l from-zinc-950 via-zinc-950/95 to-transparent
          text-zinc-400 hover:text-zinc-100 transition
          ${canRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronRight />
      </button>
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
