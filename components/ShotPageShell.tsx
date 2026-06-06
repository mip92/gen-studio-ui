'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ShotFull } from '../lib/api';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';
import { ScrollableTabs } from './ScrollableTabs';

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
  { slug: 'render',       label: 'Сцена' },
  { slug: 'videos',       label: 'Видео' },
  { slug: 'narration',    label: 'Озвучка' },
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
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!shot) {
    return <main className="px-8 py-6 text-zinc-500">Loading…</main>;
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
        <ShotBreadcrumbs projectId={projectId} shotId={shotId} shot={shot} />
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold font-mono text-zinc-100">{shot.shotCode}</h1>
          <RenderModeToggle />
        </div>
        <TabsNav projectId={projectId} shotId={shotId} shot={shot} />
      </div>
    </div>
  );
}

function ShotBreadcrumbs({ projectId, shotId, shot }: { projectId: string; shotId: string; shot: ShotFull }) {
  const pathname = usePathname();
  const tab = TABS.find((t) => pathname?.includes(`/shots/${shotId}/${t.slug}`));

  // shot is always loaded by the time we reach the StickyHeader — error/loading
  // states bail out earlier — so we never have to fall back to a truncated id.
  const items: BreadcrumbItem[] = [
    { label: 'Overview',                  href: '/' },
    { label: 'Projects',                  href: '/projects' },
    { label: shot.project?.name ?? '…',   href: `/projects/${projectId}` },
    { label: shot.scene?.title ?? shot.scene?.sceneKey ?? 'scene',
      href: `/projects/${projectId}/scenes#${shot.scene?.sceneKey ?? ''}` },
    { label: shot.shotCode,       href: `/projects/${projectId}/shots/${shotId}/prompts` },
    ...(tab ? [{ label: tab.label }] : []),
  ];
  return <Breadcrumbs items={items} />;
}

/**
 * Per-shot render-mode override. Acts can be bulk-set static/animated, but this
 * lets a single shot be flipped independently: 'animated' → Wan i2v clip,
 * 'static' → still only (video generation disabled, Ken Burns in export). The
 * Видео tab greys out immediately because TabsNav reads shot.renderMode.
 */
function RenderModeToggle() {
  const { shot, setShot, shotId } = useShotCtx();
  const [busy, setBusy] = useState(false);
  const isStatic = shot.renderMode === 'static';

  const set = async (mode: 'animated' | 'static') => {
    if (busy || (mode === 'static') === isStatic) return;
    setBusy(true);
    try {
      const updated = await api.updateShot(shotId, { renderMode: mode });
      setShot(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const base = 'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">Режим</span>
      <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="group"
           title="Переопределяет режим рендера для этого кадра, независимо от акта">
        <button type="button" disabled={busy} onClick={() => set('animated')}
                className={`${base} ${!isStatic ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
          🎬 С видео
        </button>
        <button type="button" disabled={busy} onClick={() => set('static')}
                className={`${base} border-l border-zinc-700 ${isStatic ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
          🖼 Статичный
        </button>
      </div>
    </div>
  );
}

function TabsNav({ projectId, shotId, shot }: { projectId: string; shotId: string; shot: ShotFull }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/shots/${shotId}`;
  const activeSlug = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';
  // Static shots never get a video clip — the backend rejects video generation
  // for them with a 400, so disable the tab outright instead of letting the
  // user click through to a dead end.
  const isStatic = shot.renderMode === 'static';
  return (
    <ScrollableTabs
      className="mt-3"
      tabs={TABS.map((t) => {
        const disabled = t.slug === 'videos' && isStatic;
        return {
          href:     `${base}/${t.slug}`,
          label:    t.label,
          active:   activeSlug === t.slug,
          disabled,
          title:    disabled ? 'Видео недоступно для статичного кадра (renderMode=static)' : undefined,
        };
      })}
    />
  );
}
