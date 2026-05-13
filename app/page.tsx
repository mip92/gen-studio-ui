'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ProjectListItem } from '../lib/api';

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Gen Studio</h1>
            <p className="text-zinc-500 text-xs">AI video production · LoRA pipeline · scene rendering</p>
          </div>
          <Link href="/queue" className="text-sm text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded">
            Queue →
          </Link>
        </div>
      </header>

      <main className="p-8 max-w-7xl mx-auto">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-4">Проекты</h2>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-4 mb-4">
            <p className="text-red-200 font-mono text-sm">{error}</p>
            <p className="text-zinc-400 text-sm mt-2">
              Backend на <code>{process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000'}</code> не отвечает.
            </p>
          </div>
        )}

        {!projects && !error && (
          <p className="text-zinc-500">Loading…</p>
        )}

        {projects && projects.length === 0 && (
          <p className="text-zinc-500">Нет проектов в БД.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="block bg-zinc-900 border border-zinc-800 hover:border-blue-700 hover:bg-zinc-800/50 rounded-lg p-5 transition"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium text-lg">{p.name}</h3>
                  <p className="text-xs text-zinc-500 font-mono">{p.slug}</p>
                </div>
                <span className="text-zinc-600 text-xl">→</span>
              </div>
              <p className="text-xs text-zinc-500 mt-3">
                Открыть dashboard персонажей и LoRA
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
