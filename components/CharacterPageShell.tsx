'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ProfileSummary, ProfileFull } from '../lib/api';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';
import { ScrollableTabs } from './ScrollableTabs';

const POLL_MS = 5000;

interface CharacterCtx {
  /** Per-profile readiness — sourced from `GET /profiles/:id/summary`. */
  profile:     ProfileSummary;
  profileFull: ProfileFull | null;
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
  profileId, children,
}: {
  profileId: string;
  children: React.ReactNode;
}) {
  // Project-independent: the persona page knows about a profile, full stop.
  // Project attachments live elsewhere (Состав проекта picker). Two parallel
  // fetches keep the page snappy: ProfileSummary for badges/jobs/phase,
  // ProfileFull for the editable promptBase / negative / angles / variety.
  const [profile,     setProfile]     = useState<ProfileSummary | null>(null);
  const [profileFull, setProfileFull] = useState<ProfileFull | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const reloadProfile = useCallback(async () => {
    try {
      const p = await api.getProfile(profileId);
      setProfileFull(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getProfileSummary(profileId);
      setProfile(s);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [profileId]);

  useEffect(() => { reloadProfile(); }, [reloadProfile]);
  useEffect(() => { refresh(); }, [refresh]);

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
  if (!profile) {
    return <main className="px-8 py-6 text-zinc-500">Loading…</main>;
  }

  return (
    <CharacterContext.Provider value={{
      profile, profileFull, profileId,
      refresh, reloadProfile, setProfileFull,
    }}>
      <StickyHeader profileId={profileId} profile={profile} />
      {children}
    </CharacterContext.Provider>
  );
}

function StickyHeader({
  profileId, profile,
}: {
  profileId: string;
  profile:   ProfileSummary;
}) {
  return (
    <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
      <div className="px-8 pt-3 pb-0">
        <CharacterBreadcrumbs profileId={profileId} profile={profile} />
        <div className="flex items-baseline justify-between mb-0">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">{profile.displayName ?? profile.profileCode}</h1>
            <p className="text-zinc-500 text-xs font-mono mt-0.5">{profile.profileCode}</p>
          </div>
          <span className={`text-xs px-3 py-1 rounded font-medium ${PHASE_COLOR[profile.phase]}`}>
            {PHASE_LABEL[profile.phase]}
          </span>
        </div>
        <TabsNav profileId={profileId} />
      </div>
    </div>
  );
}

function CharacterBreadcrumbs({
  profileId, profile,
}: {
  profileId: string;
  profile:   ProfileSummary;
}) {
  const pathname = usePathname();
  const base = `/characters/${profileId}`;
  const tab = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`));

  const items: BreadcrumbItem[] = [
    { label: 'Overview',          href: '/' },
    { label: 'Персонажи',         href: '/characters' },
    { label: profile.profileCode, href: `${base}/description` },
    ...(tab ? [{ label: tab.label }] : []),
  ];
  return <Breadcrumbs items={items} />;
}

function TabsNav({ profileId }: { profileId: string }) {
  const pathname = usePathname();
  const base = `/characters/${profileId}`;
  const activeSlug = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';
  return (
    <ScrollableTabs
      className="mt-3"
      tabs={TABS.map((t) => ({
        href:   `${base}/${t.slug}`,
        label:  t.label,
        active: activeSlug === t.slug,
      }))}
    />
  );
}
