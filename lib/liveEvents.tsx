'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

/**
 * ONE websocket per browser tab, carrying queue deltas from the backend.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * This file replaces ~26 independent `setInterval` pollers. There is no polling
 * anywhere in this module and no page should reintroduce any: a tab left open on
 * a tablet used to fire thousands of requests an hour with nothing running,
 * which kept the radio awake and drained the battery. Freshness now comes from
 * three event-driven sources, in this order of usefulness:
 *
 *   1. a websocket delta        — while the tab is visible and something is live
 *   2. a wake refetch           — whenever the tab comes back (see WAKE_EVENTS)
 *   3. the manual ⟳ button      — RefreshControl, always available
 *
 * ─── The contract ───────────────────────────────────────────────────────────
 * The delta carries NO rendered data — only the fact that something moved plus
 * scope ids. A subscriber reacts by calling the REST endpoint it already uses.
 * That is why this wire format never needs to know what a shot or a video looks
 * like. Read docs/live-updates.md before adding a subscriber.
 *
 * ─── Lifecycle ──────────────────────────────────────────────────────────────
 * The socket exists only while `document.visibilityState === 'visible'` AND at
 * least one mounted subscriber says it cares (`active: true`). Hidden tab → the
 * socket is closed immediately rather than waiting for the OS to freeze the tab,
 * so a pocketed tablet costs nothing. Coming back → a fresh socket, plus a wake
 * refetch, because deltas that fired while we were away are gone for good (the
 * backend keeps no replay log, on purpose).
 */

// ── Wire format (mirrors src/pipeline/queue-events.service.ts) ───────────────

export type QueueEventOp =
  | 'enqueued' | 'claimed' | 'released' | 'closed'
  | 'moved' | 'reordered' | 'prioritized' | 'hello';

export type QueueJobType =
  | 'training' | 'dataset' | 'scene' | 'end_frame' | 'video' | 'video_post'
  | 'tts' | 'bgm' | 'anchor' | 'validation' | 'anchor_validation' | 'caption'
  | 'thumbnail' | 'thumbnail_ideas' | 'prop_anchor' | 'vo_validation'
  | 'image_qc' | 'video_qc';

export interface QueueDeltaEvent {
  seq:   number;
  at:    string;
  op:    QueueEventOp;
  scope: 'entry' | 'bulk';
  entryId:   string | null;
  jobType:   QueueJobType | null;
  jobId:     string | null;
  status:    string | null;
  projectId: string | null;
  shotId:    string | null;
  profileId: string | null;
  segmentId: string | null;
}

/** A synthetic delta handed to subscribers when the socket (re)connects or the
 *  tab wakes. `op:'hello'` with everything null — a filter that inspects ids
 *  must not crash on it, which is why matchers below take the whole event. */
const RESYNC: QueueDeltaEvent = {
  seq: -1, at: '', op: 'hello', scope: 'bulk',
  entryId: null, jobType: null, jobId: null, status: null,
  projectId: null, shotId: null, profileId: null, segmentId: null,
};

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'unavailable';

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * The websocket goes STRAIGHT to the backend port, not through the frontend's
 * `/api` rewrite: Next's `rewrites()` does not proxy the websocket upgrade. This
 * mirrors DIRECT_API_BASE in lib/api.ts, which already bypasses the same proxy
 * for long comic exports.
 */
function socketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:4000/ws/queue`;
}

/**
 * Events that mean "this tab may have missed something — go re-read".
 *
 * - visibilitychange: the primary signal on every platform.
 * - pageshow:         a tab restored from the back/forward cache renders stale
 *                     state WITHOUT firing visibilitychange. Chrome has BFCache
 *                     too, so this is not iOS-only.
 * - focus:            covers multi-window / PWA paths the other two miss.
 * - online:           if Wi-Fi drops while the tab stays visible the whole time,
 *                     nothing else fires at all.
 *
 * All four collapse into one debounced wake, because unlocking a tablet commonly
 * fires several of them in the same task.
 */
const WAKE_EVENTS = ['visibilitychange', 'pageshow', 'focus', 'online'] as const;
const WAKE_DEBOUNCE_MS = 300;

/** Reconnect backoff. Capped low because a LAN reconnect should feel instant. */
const RECONNECT_MS = [500, 1_000, 2_000, 5_000, 10_000];
/**
 * Trailing debounce on each subscriber's refetch, in ms. Sized to swallow the
 * close→claim pair a single dispatch produces without being perceptible.
 */
const BURST_MS = 250;

/** Consecutive failures after which we stop trying and fall back to wake+button. */
const GIVE_UP_AFTER = 6;

// ── Context ─────────────────────────────────────────────────────────────────

interface Subscriber {
  match:  (e: QueueDeltaEvent) => boolean;
  notify: () => void;
  active: boolean;
}

interface LiveEventsApi {
  register: (s: Subscriber) => () => void;
  /** Re-evaluate whether the socket should be open. Called when `active` flips. */
  sync:     () => void;
}

/**
 * TWO contexts on purpose, and this is load-bearing.
 *
 * `status` changes on every connection transition (idle→connecting→open). If it
 * shared a context value with `register`, that value's identity would change on
 * each transition, every subscriber's effect (deps `[ctx, active]`) would re-run,
 * and the unregister half of that re-run would momentarily leave zero active
 * subscribers — which closes the socket, which opens a new one, which transitions
 * status again. That is an infinite reconnect loop: the browser opened a fresh
 * websocket every second (user 2026-08-20, DevTools showed the storm).
 *
 * So: the API context must be STABLE, and anything volatile lives in its own
 * context that only components rendering it subscribe to. Never merge them.
 */
const ApiCtx    = createContext<LiveEventsApi | null>(null);
const StatusCtx = createContext<StreamStatus>('idle');

export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const subs      = useRef(new Set<Subscriber>());
  const ws        = useRef<WebSocket | null>(null);
  const failures  = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');

  /**
   * Tell every subscriber whose filter matches — INCLUDING inactive ones.
   *
   * `active` votes on whether the socket stays open; it deliberately does NOT
   * gate notification. An idle panel still has to hear about a delta, because
   * the work may have been queued from another device — and it must hear the
   * wake resync, or a tablet picked back up would show state from before it was
   * put down. Gating notification on `active` was a bug: it made exactly the
   * cheap, once-per-pickup refetch the thing that got skipped.
   */
  const fanOut = useCallback((event: QueueDeltaEvent) => {
    for (const s of subs.current) {
      let hit = false;
      try { hit = s.match(event); } catch { hit = false; }
      if (hit) s.notify();
    }
  }, []);

  const closeSocket = useCallback(() => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const sock = ws.current;
    ws.current = null;
    if (sock) {
      // Drop handlers first so our own close doesn't schedule a reconnect.
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
      try { sock.close(); } catch { /* already dead */ }
    }
  }, []);

  /** Should a socket be open right now? */
  const wanted = useCallback(() => {
    if (typeof document === 'undefined') return false;
    if (document.visibilityState !== 'visible') return false;
    for (const s of subs.current) if (s.active) return true;
    return false;
  }, []);

  const openSocket = useCallback(() => {
    if (ws.current || typeof window === 'undefined') return;
    if (typeof window.WebSocket === 'undefined') { setStatus('unavailable'); return; }
    if (failures.current >= GIVE_UP_AFTER) { setStatus('unavailable'); return; }

    setStatus('connecting');
    let sock: WebSocket;
    try { sock = new WebSocket(socketUrl()); }
    catch { failures.current += 1; setStatus('unavailable'); return; }
    ws.current = sock;

    sock.onopen = () => {
      failures.current = 0;
      setStatus('open');
      // Always resync on connect: whatever happened before we were listening is
      // not replayed by the backend, by design.
      fanOut(RESYNC);
    };

    sock.onmessage = (ev) => {
      let event: QueueDeltaEvent;
      try { event = JSON.parse(ev.data as string) as QueueDeltaEvent; }
      catch { return; }
      // 'hello' is the server greeting; onopen already resynced, so ignore it
      // rather than firing every subscriber twice on each connect.
      if (event.op === 'hello') return;
      fanOut(event);
    };

    const dropped = () => {
      if (ws.current !== sock) return;   // superseded by a newer socket
      ws.current = null;
      failures.current += 1;
      if (failures.current >= GIVE_UP_AFTER) { setStatus('unavailable'); return; }
      setStatus('idle');
      if (!wanted()) return;
      const delay = RECONNECT_MS[Math.min(failures.current - 1, RECONNECT_MS.length - 1)];
      retryTimer.current = setTimeout(() => { retryTimer.current = null; openSocket(); }, delay);
    };
    sock.onerror = dropped;
    sock.onclose = dropped;
  }, [fanOut, wanted]);

  /** Open or close to match `wanted()`. Safe to call as often as you like. */
  const sync = useCallback(() => {
    if (wanted()) openSocket();
    else { closeSocket(); setStatus((s) => (s === 'unavailable' ? s : 'idle')); }
  }, [wanted, openSocket, closeSocket]);

  // Defer the sync by a tick. React unmounts the old subscriber before mounting
  // the new one when `active` flips, so an immediate sync would see zero
  // subscribers in between and tear the socket down just to rebuild it. Letting
  // the add/remove pair settle first makes the net effect what it should be:
  // nothing at all when the set is unchanged.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncSoon = useCallback(() => {
    if (syncTimer.current) return;
    syncTimer.current = setTimeout(() => { syncTimer.current = null; sync(); }, 0);
  }, [sync]);

  const register = useCallback((s: Subscriber) => {
    subs.current.add(s);
    syncSoon();
    return () => { subs.current.delete(s); syncSoon(); };
  }, [syncSoon]);

  // Wake handling: one debounced burst per unlock, regardless of how many of the
  // four events fired. A wake always resyncs every subscriber — the socket was
  // closed while we were away, so nothing else can have told them.
  useEffect(() => {
    const onWake = () => {
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
      wakeTimer.current = setTimeout(() => {
        wakeTimer.current = null;
        if (document.visibilityState !== 'visible') { sync(); return; }
        // A fresh attempt deserves a clean slate: a socket that failed on a dead
        // network should not stay given-up-on after the network returns.
        failures.current = 0;
        sync();
        fanOut(RESYNC);
      }, WAKE_DEBOUNCE_MS);
    };
    const onHide = () => { if (document.visibilityState !== 'visible') sync(); };

    for (const ev of WAKE_EVENTS) window.addEventListener(ev, onWake);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      for (const ev of WAKE_EVENTS) window.removeEventListener(ev, onWake);
      document.removeEventListener('visibilitychange', onHide);
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
    };
  }, [sync, fanOut]);

  // Tear the socket down on unmount (route-level HMR, app teardown).
  useEffect(() => () => {
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
    closeSocket();
  }, [closeSocket]);

  // Stable — `register`/`sync` are stable useCallbacks, so this identity never
  // changes and subscribers never re-register on a status transition.
  const api = useMemo<LiveEventsApi>(() => ({ register, sync }), [register, sync]);
  return (
    <ApiCtx.Provider value={api}>
      <StatusCtx.Provider value={status}>{children}</StatusCtx.Provider>
    </ApiCtx.Provider>
  );
}

// ── The hook every page uses ────────────────────────────────────────────────

export interface UseLiveEventsOptions {
  /**
   * Does this subscriber need the socket held OPEN? Normally the same condition
   * the component already computes to decide whether work is in flight
   * (`busyOnServer`, `anyInflight`, `pendingJobs > 0`, …).
   *
   * This gates the CONNECTION only, never notification: `false` means "don't
   * keep a socket alive on my account", not "don't tell me". You are still
   * called for matching deltas that arrive because someone else is keeping the
   * socket up, and always on the wake resync.
   */
  active: boolean;
}

/**
 * Subscribe to queue deltas.
 *
 * @param match   which deltas concern you. Receives the whole event; remember
 *                the resync event has every id null, which is why `on.all` lets
 *                it through unconditionally.
 * @param onEvent what to do about it — normally the component's existing
 *                refresh()/load(). Also called once on every (re)connect and on
 *                every tab wake, so it must be safe to call at any time.
 *
 * Neither callback needs to be memoized: both are held in refs and the only
 * effect dependency is `active`, so an inline arrow will not re-register the
 * subscriber on every render. (Memoizing is still tidier when the callback is
 * shared with other hooks.)
 * @returns the shared socket's status, for an optional "live" hint in the UI.
 */
export function useLiveEvents(
  match: (e: QueueDeltaEvent) => boolean,
  onEvent: () => void,
  opts: UseLiveEventsOptions,
): StreamStatus {
  const ctx    = useContext(ApiCtx);
  const status = useContext(StatusCtx);
  const { active } = opts;

  // Keep the newest callbacks reachable without re-registering on every render.
  const matchRef  = useRef(match);
  const notifyRef = useRef(onEvent);
  matchRef.current  = match;
  notifyRef.current = onEvent;

  // Coalesce bursts. The queue dispatches one job at a time, so a completion is
  // immediately followed by the next claim — two deltas within milliseconds, and
  // a deep queue produces such pairs continuously. Refetching twice for one
  // dispatch is pure waste, and on screen it showed up as a control that never
  // stopped flickering (user 2026-08-20: «кнопка постоянно прыгает
  // обновляется»). A short trailing debounce turns a burst into one refetch.
  //
  // This is NOT a poll: with no events, no timer exists and nothing fires.
  const burst = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const sub: Subscriber = {
      match:  (e) => matchRef.current(e),
      notify: () => {
        if (burst.current) clearTimeout(burst.current);
        burst.current = setTimeout(() => { burst.current = null; notifyRef.current(); }, BURST_MS);
      },
      active,
    };
    const unregister = ctx.register(sub);
    return () => {
      unregister();
      if (burst.current) { clearTimeout(burst.current); burst.current = null; }
    };
  }, [ctx, active]);

  return ctx ? status : 'unavailable';
}

/** Convenience matchers, so pages don't hand-roll the same predicates. */
export const on = {
  /** Anything at all — for the queue and overview screens, which watch the lot. */
  any:      () => true,
  /** A job finished (completed/failed/cancelled/skipped). The event to use when
   *  refetching is expensive, e.g. project stats or a QC report. */
  finished: (e: QueueDeltaEvent) => e.op === 'closed',
  project:  (projectId: string | null | undefined) =>
    (e: QueueDeltaEvent) => !!projectId && e.projectId === projectId,
  shot:     (shotId: string | null | undefined) =>
    (e: QueueDeltaEvent) => !!shotId && e.shotId === shotId,
  profile:  (profileId: string | null | undefined) =>
    (e: QueueDeltaEvent) => !!profileId && e.profileId === profileId,
  job:      (jobId: string | null | undefined) =>
    (e: QueueDeltaEvent) => !!jobId && e.jobId === jobId,
  types:    (...types: QueueJobType[]) =>
    (e: QueueDeltaEvent) => !!e.jobType && types.includes(e.jobType),
  /** Every matcher must hold. The resync event (all ids null) is always let
   *  through — it means "you were disconnected, re-read regardless". */
  all: (...ms: Array<(e: QueueDeltaEvent) => boolean>) => (e: QueueDeltaEvent) =>
    e.seq === -1 || ms.every((m) => m(e)),
};
