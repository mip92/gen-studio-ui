<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# No polling. Ever.

There is **no `setInterval` in this app** and none may be reintroduced. State
freshness comes from the queue websocket, a refetch when the tab wakes, and the
manual ⟳ button — in that order.

Subscribe with `useLiveEvents` from `lib/liveEvents.tsx`, wrap the fetch in
`useRefreshable`, and put a `RefreshControl` in `PageHeader`'s `actions` slot:

```tsx
const { refreshing, lastUpdatedAt, refresh } = useRefreshable(load);
const match = useCallback(on.all(on.shot(shotId), on.types('video')), [shotId]);
useLiveEvents(match, refresh, { active: anyInFlight });
```

**Read `../gen-studio/docs/live-updates.md` before adding a live view**, and note
the one rule people get wrong: `active` decides whether the shared socket stays
OPEN, it does not gate notification — an `active: false` subscriber still gets
deltas and still refetches on every tab wake.

Why it matters: the primary device is a tablet on the LAN, so the metric is radio
wake-ups, not request count. The ~26 timers this replaced burned ~24 000
requests/hour on one page with an empty queue and never slept on a hidden tab.

The only legal timers left are the two in `components/PublishStepper.tsx`, which
watch a comic-export manifest on disk rather than the queue.

