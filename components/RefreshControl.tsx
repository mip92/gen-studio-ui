'use client';

/**
 * «⟳ Обновить» + «данные от HH:MM» — the manual freshness affordance.
 *
 * Every page that used to auto-poll gets one of these, because a page that
 * stopped ticking has to say so: without the timestamp there is no way to tell
 * "nothing has happened" from "this view is an hour stale". The button is the
 * escape hatch for when the live socket never connected (see lib/liveEvents.tsx).
 *
 * PRESENTATIONAL ONLY, and deliberately unpositioned — an inline-flex fragment
 * that the caller's own row lays out. Do NOT wrap it in a sticky container and
 * do NOT give a table row its own copy: the queue table keeps one action row per
 * entry and rows of uniform height, so this belongs in the toolbar ABOVE a
 * table, or in PageHeader's `actions` slot, never inside a <tr>.
 */
export function RefreshControl({
  lastUpdatedAt,
  refreshing,
  onRefresh,
  live = false,
}: {
  /** ms epoch of the last successful fetch, or null if none has landed yet. */
  lastUpdatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** True while the live socket is connected — renders a quiet dot so the user
   *  can tell "this updates itself" from "press the button". */
  live?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {lastUpdatedAt !== null && (
        <span className="text-xs text-zinc-500 tabular-nums whitespace-nowrap" title="Когда данные последний раз обновлялись">
          {live && <span className="text-emerald-500 mr-1" title="Живое обновление подключено">●</span>}
          данные от {new Date(lastUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {/* The label NEVER changes — only the glyph spins in place, and the
          timestamp is tabular-nums. On a busy queue this control refetches every
          few seconds, and swapping «⟳ Обновить» for «…» made the button resize
          on every one of them, so it visibly jumped (user 2026-08-20: «кнопка
          постоянно прыгает»). Anything whose width depends on live state has to
          be width-stable, or it becomes a twitch on screen. */}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
        title="Обновить"
      >
        <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>⟳</span>
        {' Обновить'}
      </button>
    </span>
  );
}
