'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { Breadcrumbs } from './Breadcrumbs';

type LibChar    = Awaited<ReturnType<typeof api.listLibraryCharacters>>[number];
type LibProfile = LibChar['profiles'][number];

const POLL_MS = 10_000;

/**
 * Global character library. Same visual language as the old project-scoped
 * CharactersList (aspect-square dataset preview + LoRA / dataset badges) but
 * sourced from /library/characters and freed from any single-project context.
 *
 * One card per profile (a character with multiple profiles renders one card
 * per profile — matches the old project list behaviour, where each profile
 * was its own row).
 */
export function LibraryCharactersList() {
  const [chars, setChars] = useState<LibChar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listLibraryCharacters();
      setChars(list);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (error && !chars) {
    return (
      <main className="px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!chars) return <main className="px-8 py-6 max-w-7xl mx-auto text-zinc-500">Loading…</main>;

  // Flatten character → profile cards. A character with N profiles gets N cards.
  // Library characters with zero profiles are still shown (rare; will render
  // the no-dataset state).
  const cards: Array<{ char: LibChar; profile: LibProfile | null }> = [];
  for (const c of chars) {
    if (c.profiles.length === 0) cards.push({ char: c, profile: null });
    else for (const p of c.profiles) cards.push({ char: c, profile: p });
  }

  return (
    <main className="px-8 py-6">
      <Breadcrumbs items={[
        { label: 'Overview',   href: '/' },
        { label: 'Персонажи' },
      ]} />
      <div className="flex justify-between items-baseline mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Персонажи ({cards.length})</h1>
          <p className="text-zinc-500 text-sm">
            Глобальная библиотека. Промпты, датасеты, тренировка — здесь. Проекты подключают персонажей через «Состав».
          </p>
        </div>
        <button onClick={refresh} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1">
          ↻ refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(({ char, profile }) => (
          <CharacterCard
            key={profile ? profile.id : char.id}
            char={char}
            profile={profile}
          />
        ))}
      </div>
    </main>
  );
}

function CharacterCard({ char, profile }: { char: LibChar; profile: LibProfile | null }) {
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [datasetCount,    setDatasetCount]    = useState<number | null>(null);
  const [anchorExists,    setAnchorExists]    = useState<boolean>(false);

  // Attached project styles drive WHICH identity badge to surface. A character
  // pinned only to cartoon projects shouldn't be tagged "нет датасета" — that
  // metric doesn't apply to the IP-Adapter pipeline. A photoreal-only char
  // keeps the legacy dataset/LoRA badge.
  const styles       = char.projectLinks.map((l) => l.project.visualStyle ?? 'photoreal_cinematic');
  const hasPhotoreal = styles.some((s) => s === 'photoreal_cinematic');
  const hasCartoon   = styles.some((s) => s !== 'photoreal_cinematic');
  const isCartoonOnly = hasCartoon && !hasPhotoreal;
  const isLibraryOnly = styles.length === 0;

  useEffect(() => {
    if (!profile) return;
    // Cartoon-only characters preview their anchor PNG; photoreal characters
    // preview a dataset image. Library-mode characters try anchor first, then
    // dataset, so whichever exists shows up.
    if (isCartoonOnly || isLibraryOnly) {
      api.getAnchor(profile.id)
        .then((r) => { setAnchorExists(r.exists); })
        .catch(() => { setAnchorExists(false); });
    }
    if (!isCartoonOnly) {
      api.listImages(profile.id)
        .then((r) => {
          setDatasetCount(r.count);
          const usable = r.images.find((i) => i.size > 50_000) ?? r.images[0];
          setPreviewFilename(usable?.filename ?? null);
        })
        .catch(() => { setDatasetCount(0); });
    } else {
      setDatasetCount(0);
    }
  }, [profile, isCartoonOnly, isLibraryOnly]);

  const loraReady = !!profile?.loraPath;
  const target    = profile?.targetImages ?? 0;
  const dcount    = datasetCount ?? 0;

  // Asset badge: photoreal characters show dataset/LoRA progress; cartoon-only
  // characters show anchor readiness instead.
  const assetBadge: { label: string; cls: string } = isCartoonOnly
    ? (anchorExists
        ? { label: 'anchor готов', cls: 'bg-purple-700 text-purple-100' }
        : { label: 'нет anchor',   cls: 'bg-zinc-700 text-zinc-200' })
    : isLibraryOnly
      ? { label: loraReady ? 'LoRA готова' : (anchorExists ? 'anchor готов' : 'library'), cls: loraReady ? 'bg-emerald-700 text-emerald-100' : (anchorExists ? 'bg-purple-700 text-purple-100' : 'bg-zinc-700 text-zinc-300') }
      : loraReady
        ? { label: 'LoRA готова', cls: 'bg-emerald-700 text-emerald-100' }
        : dcount === 0
          ? { label: 'нет датасета', cls: 'bg-zinc-700 text-zinc-200' }
          : target > 0 && dcount < target
            ? { label: `датасет ${dcount}/${target}`, cls: 'bg-yellow-700 text-yellow-100' }
            : { label: `датасет ${dcount}`, cls: 'bg-purple-700 text-purple-100' };

  const href = profile ? `/characters/${profile.id}/description` : '#';
  const attachedProjects = char.projectLinks.map((l) => l.project.slug);

  return (
    <div className="group bg-zinc-900 border border-zinc-800 hover:border-blue-700 rounded-lg overflow-hidden transition flex flex-col">
      <Link href={href} className="block flex-1">
        <div className="aspect-square bg-zinc-950 relative">
          {/* Preview source depends on identity pipeline:
             - cartoon-only character → anchor PNG (data/<slug>/reference/<code>_anchor.png)
             - photoreal character → first usable dataset image
             - library-mode character → anchor if exists, else first dataset image */}
          {profile && isCartoonOnly && anchorExists ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.anchorRawUrl(profile.id)}
              alt={profile.profileCode}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : profile && isLibraryOnly && anchorExists && !previewFilename ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.anchorRawUrl(profile.id)}
              alt={profile.profileCode}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : previewFilename && profile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.imageUrl(profile.id, previewFilename)}
              alt={profile.profileCode}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">
              {dcount > 0
                ? '…'
                : (profile
                    ? (isCartoonOnly ? 'нет anchor' : 'нет датасета')
                    : 'нет профиля')}
            </div>
          )}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded font-medium ${assetBadge.cls}`}>
              {assetBadge.label}
            </span>
            {attachedProjects.length > 0 ? (
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-900/60 text-blue-200 font-mono">
                {attachedProjects.length === 1 ? attachedProjects[0] : `${attachedProjects.length} проекта`}
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 font-mono">
                свободный
              </span>
            )}
          </div>
        </div>
        <div className="p-4">
          <div className="font-medium">{char.displayName ?? char.code}</div>
          <div className="text-xs text-zinc-500 font-mono mb-3">
            {profile?.profileCode ?? char.code}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <Stat label="датасет" value={`${dcount}`} />
            <Stat label="возраст" value={profile?.ageLabel ?? '—'} />
            <Stat label="LoRA"    value={loraReady ? 'yes' : '—'} />
          </div>
        </div>
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-600 text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-zinc-300 font-mono">{value}</div>
    </div>
  );
}
