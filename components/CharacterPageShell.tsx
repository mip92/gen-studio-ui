'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, DashboardResponse, ProfileSummary, ProfileFull } from '../lib/api';

const POLL_MS = 5000;

interface CharacterCtx {
  dashboard:   DashboardResponse;
  profile:     ProfileSummary;
  profileFull: ProfileFull | null;
  projectId:   string;
  profileId:   string;
  refresh:     () => Promise<void>;
  reloadProfile: () => Promise<void>;
  setProfileFull: (p: ProfileFull) => void;
}

const CharacterContext = createContext<CharacterCtx | null>(null);

export function useCharacterCtx(): CharacterCtx {
  const ctx = useContext(CharacterContext);
  if (!ctx) throw new Error('useCharacterCtx must be used inside <CharacterPageShell>');
  return ctx;
}

const TABS = [
  { slug: 'description', label: 'Описание' },
  { slug: 'reference',   label: 'Reference' },
  { slug: 'dataset',     label: 'Датасет' },
  { slug: 'training',    label: 'Тренировка' },
  { slug: 'loras',       label: 'LoRA' },
] as const;

const PHASE_COLOR: Record<ProfileSummary['phase'], string> = {
  idle:        'bg-zinc-700  text-zinc-200',
  queued:      'bg-amber-700 text-amber-100',
  generating:  'bg-blue-700  text-blue-100',
  has_dataset: 'bg-purple-700 text-purple-100',
  training:    'bg-orange-700 text-orange-100',
  ready:       'bg-emerald-700 text-emerald-100',
};

const PHASE_LABEL: Record<ProfileSummary['phase'], string> = {
  idle:        'нет датасета',
  queued:      'в очереди',
  generating:  'генерируется',
  has_dataset: 'датасет готов',
  training:    'обучается',
  ready:       'LoRA готова',
};

export function CharacterPageShell({
  projectId, profileId, children,
}: {
  projectId: string; profileId: string; children: React.ReactNode;
}) {
  const [dashboard,   setDashboard]   = useState<DashboardResponse | null>(null);
  const [profileFull, setProfileFull] = useState<ProfileFull | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.dashboard(projectId);
      setDashboard(d);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  const reloadProfile = useCallback(async () => {
    try {
      const p = await api.getProfile(profileId);
      setProfileFull(p);
    } catch { /* ignore */ }
  }, [profileId]);

  useEffect(() => { refresh(); reloadProfile(); }, [refresh, reloadProfile]);

  // Periodic refresh so dataset/training phase keeps updating.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) {
    return (
      <main className="px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!dashboard) {
    return <main className="px-8 py-6 text-zinc-500">Loading…</main>;
  }

  const profile = dashboard.profiles.find((p) => p.profileId === profileId);
  if (!profile) {
    return (
      <main className="px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">
          Profile {profileId} not found
        </div>
      </main>
    );
  }

  return (
    <CharacterContext.Provider value={{
      dashboard, profile, profileFull, projectId, profileId,
      refresh, reloadProfile, setProfileFull,
    }}>
      <StickyHeader projectId={projectId} profileId={profileId} project={dashboard.project} profile={profile} />
      {children}
    </CharacterContext.Provider>
  );
}

function StickyHeader({
  projectId, profileId, project, profile,
}: {
  projectId: string;
  profileId: string;
  project:   DashboardResponse['project'];
  profile:   ProfileSummary;
}) {
  return (
    <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-8 pt-3 pb-0">
        <Breadcrumbs projectId={projectId} profileId={profileId} project={project} profile={profile} />
        <div className="flex items-baseline justify-between mb-0">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">{profile.displayName ?? profile.profileCode}</h1>
            <p className="text-zinc-500 text-xs font-mono mt-0.5">{profile.profileCode}</p>
          </div>
          <span className={`text-xs px-3 py-1 rounded font-medium ${PHASE_COLOR[profile.phase]}`}>
            {PHASE_LABEL[profile.phase]}
          </span>
        </div>
        <TabsNav projectId={projectId} profileId={profileId} />
      </div>
    </div>
  );
}

function Breadcrumbs({
  projectId, profileId, project, profile,
}: {
  projectId: string;
  profileId: string;
  project:   DashboardResponse['project'];
  profile:   ProfileSummary;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/characters/${profileId}`;
  const tab = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`));

  return (
    <nav className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5 flex-wrap" aria-label="Breadcrumb">
      <Link href="/projects" className="hover:text-zinc-300">Projects</Link>
      <Sep />
      <Link href={`/projects/${projectId}/characters`} className="hover:text-zinc-300">
        {project.name}
      </Link>
      <Sep />
      <Link href={`/projects/${projectId}/characters`} className="hover:text-zinc-300">
        Characters
      </Link>
      <Sep />
      <Link href={`${base}/description`} className="font-mono hover:text-zinc-300">
        {profile.profileCode}
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

function TabsNav({ projectId, profileId }: { projectId: string; profileId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/characters/${profileId}`;
  const activeSlug = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';

  return (
    <div className="flex border-b border-zinc-800 -mb-px mt-3 overflow-x-auto" role="tablist">
      {TABS.map((t) => {
        const isActive = activeSlug === t.slug;
        return (
          <Link
            key={t.slug}
            href={`${base}/${t.slug}`}
            role="tab"
            aria-selected={isActive}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
