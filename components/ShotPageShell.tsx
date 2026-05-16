'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, ShotFull } from '../lib/api';

type CharactersList = Awaited<ReturnType<typeof api.listCharacters>>;

interface ShotCtx {
  shot:        ShotFull;
  setShot:     (s: ShotFull) => void;
  reload:      () => Promise<void>;
  characters:  CharactersList;
  projectId:   string;
  shotId:      string;
}

const ShotContext = createContext<ShotCtx | null>(null);

export function useShotCtx(): ShotCtx {
  const ctx = useContext(ShotContext);
  if (!ctx) throw new Error('useShotCtx must be used inside <ShotPageShell>');
  return ctx;
}

const TABS = [
  { slug: 'prompts',      label: 'Промпты' },
  { slug: 'participants', label: 'Participants' },
  { slug: 'render',       label: 'Рендер кадра' },
  { slug: 'videos',       label: 'Видео (Wan2.2 i2v)' },
] as const;

export function ShotPageShell({
  projectId, shotId, children,
}: {
  projectId: string; shotId: string; children: React.ReactNode;
}) {
  const [shot,       setShot]       = useState<ShotFull | null>(null);
  const [characters, setCharacters] = useState<CharactersList>([]);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, chs] = await Promise.all([api.getShot(shotId), api.listCharacters(projectId)]);
      setShot(s);
      setCharacters(chs);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [shotId, projectId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <main className="px-8 py-6">
        <Breadcrumbs projectId={projectId} shotId={shotId} />
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!shot) {
    return (
      <main className="px-8 py-6">
        <Breadcrumbs projectId={projectId} shotId={shotId} />
        <p className="text-zinc-500">Loading…</p>
      </main>
    );
  }

  return (
    <ShotContext.Provider value={{ shot, setShot, reload: load, characters, projectId, shotId }}>
      <StickyHeader projectId={projectId} shotId={shotId} shot={shot} />
      {children}
    </ShotContext.Provider>
  );
}

function StickyHeader({ projectId, shotId, shot }: { projectId: string; shotId: string; shot: ShotFull }) {
  return (
    <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-8 pt-3 pb-0">
        <Breadcrumbs projectId={projectId} shotId={shotId} shot={shot} />
        <div className="flex items-baseline justify-between mb-0">
          <div>
            <div className="text-zinc-500 text-xs font-mono mb-1">{shot.scene?.title ?? shot.scene?.sceneKey}</div>
            <h1 className="text-xl font-semibold font-mono text-zinc-100">{shot.shotCode}</h1>
          </div>
        </div>
        <TabsNav projectId={projectId} shotId={shotId} />
      </div>
    </div>
  );
}

function Breadcrumbs({ projectId, shotId, shot }: { projectId: string; shotId: string; shot?: ShotFull }) {
  const pathname = usePathname();
  const tab = TABS.find((t) => pathname?.includes(`/shots/${shotId}/${t.slug}`));

  return (
    <nav className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5 flex-wrap" aria-label="Breadcrumb">
      <Link href="/projects" className="hover:text-zinc-300">Projects</Link>
      <Sep />
      <Link href={`/projects/${projectId}/scenes`} className="hover:text-zinc-300">
        {shot?.project?.name ?? projectId.slice(0, 8)}
      </Link>
      <Sep />
      <Link href={`/projects/${projectId}/scenes#${shot?.scene?.sceneKey ?? ''}`} className="hover:text-zinc-300">
        {shot?.scene?.title ?? shot?.scene?.sceneKey ?? 'scene'}
      </Link>
      <Sep />
      <Link href={`/projects/${projectId}/shots/${shotId}/prompts`} className="font-mono hover:text-zinc-300">
        {shot?.shotCode ?? shotId.slice(0, 8)}
      </Link>
      {tab && (
        <>
          <Sep />
          <span className="text-zinc-300">{tab.label}</span>
        </>
      )}
    </nav>
  );
}

function Sep() {
  return <span className="text-zinc-700">/</span>;
}

function TabsNav({ projectId, shotId }: { projectId: string; shotId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/shots/${shotId}`;
  const activeSlug = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';

  return (
    <div className="flex border-b border-zinc-800 -mb-px mt-3" role="tablist">
      {TABS.map((t) => {
        const isActive = activeSlug === t.slug;
        return (
          <Link
            key={t.slug}
            href={`${base}/${t.slug}`}
            role="tab"
            aria-selected={isActive}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'text-blue-400 border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
