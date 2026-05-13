'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ScenesResponse, DashboardResponse } from '../lib/api';

export function ProjectOverview({ id }: { id: string }) {
  const [scenes,    setScenes]    = useState<ScenesResponse    | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([api.listScenes(id), api.dashboard(id)]);
        setScenes(s);
        setDashboard(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (error)         return <Pad><Err msg={error} /></Pad>;
  if (!scenes || !dashboard) return <Pad><p className="text-zinc-500">Loading…</p></Pad>;

  const totalShots = scenes.scenes.reduce((sum, s) => sum + s.shots.length, 0);
  const ready      = dashboard.profiles.filter((p) => p.loraReady).length;
  const total      = dashboard.profiles.length;

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Сцены"      value={String(scenes.scenes.length)} />
        <Stat label="Кадры"      value={String(totalShots)} />
        <Stat label="Персонажи"  value={String(total)} />
        <Stat label="LoRA готовы" value={`${ready} / ${total}`} highlight={ready > 0} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Сценарий</h2>
        <div className="space-y-4">
          {scenes.scenes.map((s) => (
            <article key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="font-medium">
                  <span className="text-zinc-500 text-xs font-mono mr-2">#{s.sortOrder}</span>
                  {s.title ?? s.sceneKey}
                </h3>
                <Link
                  href={`/projects/${id}/scenes#${s.sceneKey}`}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {s.shots.length} кадров →
                </Link>
              </header>
              <ol className="space-y-1 text-sm text-zinc-300">
                {s.shots.slice(0, 5).map((sh) => (
                  <li key={sh.id} className="flex gap-2">
                    <span className="text-zinc-600 font-mono text-xs w-20 flex-shrink-0">{sh.shotCode}</span>
                    <span className="flex-1">{sh.beat ?? <em className="text-zinc-600">(нет описания)</em>}</span>
                    {sh.participants.length > 0 && (
                      <span className="text-xs text-zinc-500 flex-shrink-0">
                        {sh.participants.map((p) => p.characterCode ?? '—').join(', ')}
                      </span>
                    )}
                  </li>
                ))}
                {s.shots.length > 5 && (
                  <li className="text-xs text-zinc-600 pl-22">
                    + ещё {s.shots.length - 5} кадров
                  </li>
                )}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({
  label, value, highlight,
}: {
  label:      string;
  value:      string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${highlight ? 'border-emerald-700/60' : ''}`}>
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <main className="px-8 py-6 max-w-7xl mx-auto">{children}</main>;
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="bg-red-900/40 border border-red-700 rounded p-4">
      <p className="text-red-200 font-mono text-sm">{msg}</p>
    </div>
  );
}
