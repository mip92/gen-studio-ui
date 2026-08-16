'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ProjectListItem, QueueListResponse, QueueRow } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

const POLL_MS = 5000;

export default function OverviewPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [active,   setActive]   = useState<QueueListResponse | null>(null);
  const [done,     setDone]     = useState<QueueListResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [p, a, d] = await Promise.all([
          api.listProjects(),
          api.pipelineQueue({ finished: false, sort: 'queuedAt',    order: 'asc',  limit: 10 }),
          api.pipelineQueue({ finished: true,  sort: 'completedAt', order: 'desc', limit: 5  }),
        ]);
        if (cancelled) return;
        setProjects(p);
        setActive(a);
        setDone(d);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Active count = pending + running across all types. "running" here is loose:
  // anything not in the terminal bucket. Server already filtered via finished=false.
  const activeCount  = active?.total ?? 0;
  const doneCount    = done?.total   ?? 0;
  const runningRows  = (active?.rows ?? []).filter((r) => r.status === 'running');

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <PageHeader
        crumbs={[{ label: 'Overview' }]}
        title="Gen Studio"
        subtitle="AI video production · LoRA pipeline · scene rendering"
      />

      <main className="p-4 sm:p-8 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-4">
            <p className="text-red-200 font-mono text-sm">{error}</p>
          </div>
        )}

        {/* ── Stat tiles ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Tile href="/projects"     label="Projects"            value={projects?.length ?? '…'} hint="всех проектов в БД" />
          <Tile href="/queue/active" label="В очереди / работает" value={activeCount}              hint={`${runningRows.length} сейчас на GPU · ${Math.max(0, activeCount - runningRows.length)} ждут`} />
          <Tile href="/queue/done"   label="Завершено"           value={doneCount}                hint="включая failed и cancelled" />
        </div>

        {/* ── Currently running ──────────────────────────────────────── */}
        <Section title="Сейчас на GPU" linkHref="/queue/active" linkLabel="к очереди →">
          {runningRows.length === 0
            ? <Empty>ничего не работает</Empty>
            : runningRows.map((r) => <ActivityRow key={r.entryId} row={r} mode="running" />)}
        </Section>

        {/* ── Recent done ────────────────────────────────────────────── */}
        <Section title="Последние завершённые" linkHref="/queue/done" linkLabel="всё →">
          {(done?.rows.length ?? 0) === 0
            ? <Empty>пока пусто</Empty>
            : done!.rows.map((r) => <ActivityRow key={r.entryId} row={r} mode="done" />)}
        </Section>
      </main>
    </div>
  );
}

function Tile({ href, label, value, hint }: { href: string; label: string; value: number | string; hint?: string }) {
  return (
    <Link href={href}
          className="block bg-zinc-900 border border-zinc-800 hover:border-blue-700 hover:bg-zinc-800/50 rounded-lg p-5 transition">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
    </Link>
  );
}

function Section({ title, linkHref, linkLabel, children }: {
  title: string; linkHref: string; linkLabel: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">{title}</h2>
        <Link href={linkHref} className="text-xs text-zinc-500 hover:text-zinc-200">{linkLabel}</Link>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded divide-y divide-zinc-800">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-zinc-600 text-sm italic">— {children} —</div>;
}

function ActivityRow({ row, mode }: { row: QueueRow; mode: 'running' | 'done' }) {
  const ts = mode === 'running' ? row.startedAt : row.completedAt;
  return (
    <div className="px-3 py-2 flex items-center gap-3 text-sm">
      <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${typeBadge(row.type)}`}>{row.type}</span>
      <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${statusBadge(row.status)}`}>{row.status}</span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs truncate text-zinc-300">
          <span className="text-zinc-500">{row.projectSlug} / </span>
          {row.context && <>{row.context} <span className="text-zinc-500">·</span> </>}{row.label}
        </div>
      </div>
      <span className="text-xs text-zinc-500 whitespace-nowrap">{fmt(ts)}</span>
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const dt = Date.now() - d.getTime();
  if (dt < 0)             return 'just now';
  if (dt < 60_000)        return `${Math.floor(dt / 1000)}s ago`;
  if (dt < 3_600_000)     return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000)    return `${Math.floor(dt / 3_600_000)}h ago`;
  return d.toLocaleString();
}

function typeBadge(t: string): string {
  if (t === 'training')      return 'bg-purple-950/40 text-purple-300 border-purple-900';
  if (t === 'dataset')       return 'bg-blue-950/40   text-blue-300   border-blue-900';
  if (t === 'scene')         return 'bg-amber-950/40  text-amber-300  border-amber-900';
  if (t === 'end_frame')     return 'bg-yellow-950/40 text-yellow-300 border-yellow-900';
  if (t === 'video')         return 'bg-rose-950/40   text-rose-300   border-rose-900';
  if (t === 'video_post')    return 'bg-pink-950/40   text-pink-300   border-pink-900';
  if (t === 'tts')           return 'bg-cyan-950/40   text-cyan-300   border-cyan-900';
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
