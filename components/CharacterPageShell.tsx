'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ProfileSummary, ProfileFull, ProfileStyleReadiness } from '../lib/api';
import { BreadcrumbItem } from './Breadcrumbs';
import { PageHeader } from './PageHeader';

const POLL_MS = 5000;

interface CharacterCtx {
  /** Per-profile readiness — sourced from `GET /profiles/:id/summary`. */
  profile:     ProfileSummary;
  profileFull: ProfileFull | null;
  profileId:   string;
  /** Per-style identity-asset readiness — sourced from `GET /profiles/:id/style-readiness`.
   *  Null while loading. Drives conditional UI: cartoon characters hide
   *  dataset/training/LoRA controls + warnings. */
  readiness:   ProfileStyleReadiness | null;
  /** Effective identity pipeline for this character — derived from attached
   *  projects' visualStyle. 'lora' = photoreal (needs dataset + LoRA training);
   *  'anchor' = cartoon (needs only an anchor PNG); 'mixed' = attached to both;
   *  'none' = library mode, no project attached yet. */
  identityPipeline: 'lora' | 'anchor' | 'mixed' | 'none';
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

const ALL_TABS = [
  { slug: 'description', label: 'Описание',   pipelines: ['lora', 'anchor', 'mixed', 'none'] as const },
  { slug: 'reference',   label: 'Reference',  pipelines: ['lora', 'anchor', 'mixed', 'none'] as const },
  // Dataset + Training + LoRA tabs only make sense for the photoreal pipeline.
  // For cartoon (anchor-only) characters these are hidden — anchor lives on
  // the Reference tab.
  { slug: 'dataset',     label: 'Датасет',    pipelines: ['lora', 'mixed', 'none'] as const },
  { slug: 'training',    label: 'Тренировка', pipelines: ['lora', 'mixed', 'none'] as const },
  { slug: 'loras',       label: 'LoRA',       pipelines: ['lora', 'mixed', 'none'] as const },
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
  const [readiness,   setReadiness]   = useState<ProfileStyleReadiness | null>(null);
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
      const [s, r] = await Promise.all([
        api.getProfileSummary(profileId),
        api.profileStyleReadiness(profileId).catch(() => null),
      ]);
      setProfile(s);
      if (r) setReadiness(r);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [profileId]);

  useEffect(() => { reloadProfile(); }, [reloadProfile]);
  useEffect(() => { refresh(); }, [refresh]);

  // Derive the identity pipeline from attached projects' styles.
  const attachedStyles = readiness?.attachedProjects ?? [];
  const hasPhotoreal = attachedStyles.some((p) => p.visualStyle === 'photoreal_cinematic');
  const hasCartoon   = attachedStyles.some((p) => p.visualStyle !== 'photoreal_cinematic');
  const identityPipeline: 'lora' | 'anchor' | 'mixed' | 'none' =
    attachedStyles.length === 0 ? 'none'
      : (hasPhotoreal && hasCartoon) ? 'mixed'
      : hasPhotoreal ? 'lora'
      : 'anchor';

  // Periodic refresh so dataset/training phase keeps updating.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!profile) {
    return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;
  }

  return (
    <CharacterContext.Provider value={{
      profile, profileFull, profileId, readiness, identityPipeline,
      refresh, reloadProfile, setProfileFull,
    }}>
      <StickyHeader profileId={profileId} profile={profile} identityPipeline={identityPipeline} readiness={readiness} />
      {children}
    </CharacterContext.Provider>
  );
}

function StickyHeader({
  profileId, profile, identityPipeline, readiness,
}: {
  profileId:        string;
  profile:          ProfileSummary;
  identityPipeline: 'lora' | 'anchor' | 'mixed' | 'none';
  readiness:        ProfileStyleReadiness | null;
}) {
  // For cartoon-only characters, the dataset/LoRA phase badge is misleading
  // — they don't need any of that. Show anchor-readiness instead.
  const isCartoonOnly = identityPipeline === 'anchor';
  const anchorReady   = readiness
    ? Object.values(readiness.styles).some((s) => s.identityStack !== 'lora_face_lock' && s.ready)
    : false;
  const badgeClass = isCartoonOnly
    ? (anchorReady ? 'bg-emerald-700 text-emerald-100' : 'bg-zinc-700 text-zinc-200')
    : PHASE_COLOR[profile.phase];
  const badgeText = isCartoonOnly
    ? (anchorReady ? 'anchor готов' : 'нет anchor')
    : PHASE_LABEL[profile.phase];

  const pathname = usePathname();
  const base = `/characters/${profileId}`;
  // Filter tabs by the character's identity pipeline. Cartoon characters
  // (anchor-only) skip Dataset / Training / LoRA — those concepts don't apply.
  const visible = ALL_TABS.filter((t) => (t.pipelines as readonly string[]).includes(identityPipeline));
  const activeSlug = visible.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';
  const activeTab = visible.find((t) => t.slug === activeSlug);

  const crumbs: BreadcrumbItem[] = [
    { label: 'Overview',          href: '/' },
    { label: 'Персонажи',         href: '/characters' },
    { label: profile.profileCode, href: `${base}/description` },
    ...(activeTab ? [{ label: activeTab.label }] : []),
  ];

  return (
    <PageHeader
      crumbs={crumbs}
      title={profile.displayName ?? profile.profileCode}
      subtitle={
        <span className="font-mono">
          {profile.profileCode}
          {' · '}
          <span className={
            identityPipeline === 'anchor' ? 'text-purple-400' :
            identityPipeline === 'lora'   ? 'text-amber-400'  :
            identityPipeline === 'mixed'  ? 'text-cyan-400'   :
            'text-zinc-600'
          }>
            {identityPipeline === 'anchor' ? 'cartoon (anchor)' :
             identityPipeline === 'lora'   ? 'photoreal (LoRA)' :
             identityPipeline === 'mixed'  ? 'photoreal+cartoon' :
             'library (нет проекта)'}
          </span>
        </span>
      }
      actions={
        <span className={`text-xs px-3 py-1 rounded font-medium ${badgeClass}`}>
          {badgeText}
        </span>
      }
      tabs={visible.map((t) => ({
        href:   `${base}/${t.slug}`,
        label:  t.label,
        active: activeSlug === t.slug,
      }))}
    />
  );
}
