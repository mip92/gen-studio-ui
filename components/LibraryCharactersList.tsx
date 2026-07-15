'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, LibraryCharacter } from '../lib/api';
import { PageHeader } from './PageHeader';
import { AsyncGenericList } from './AsyncGenericList';

type LibChar    = LibraryCharacter;
type LibProfile = LibChar['profiles'][number];

/**
 * Global character library, server-paginated with infinite scroll
 * (AsyncGenericList). ONE card per CHARACTER — multi-profile characters
 * (age bands like HERO_KID/HERO_MID/HERO_OLD) used to render one card per
 * profile, which read as duplicates once every profile got an anchor. The
 * card previews the first profile that actually has an anchor (falls back
 * to dataset image / first profile) and badges the profile count.
 */
export function LibraryCharactersList() {
  const fetchPage = useCallback(
    (skip: number, take: number) => api.listLibraryCharactersPage(skip, take),
    [],
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Overview',   href: '/' },
          { label: 'Персонажи' },
        ]}
        title="Персонажи"
        subtitle="Глобальная библиотека. Промпты, датасеты, тренировка — здесь. Проекты подключают персонажей через «Состав»."
      />
      <main className="px-4 sm:px-8 py-6">
      <AsyncGenericList<LibChar>
        fetchPage={fetchPage}
        keyOf={(c) => c.id}
        loadingText="Загрузка персонажей…"
        emptyText="Персонажей пока нет"
        renderItem={(char) => <CharacterCard key={char.id} char={char} />}
      />
      </main>
    </>
  );
}

function CharacterCard({ char }: { char: LibChar }) {
  const profiles = char.profiles;
  const firstProfile: LibProfile | null = profiles[0] ?? null;

  /** Profile whose anchor we preview (first profile that has one). */
  const [anchorProfileId, setAnchorProfileId] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [datasetCount,    setDatasetCount]    = useState<number | null>(null);
  const [probed,          setProbed]          = useState(false);

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
    let cancelled = false;
    if (!firstProfile) { setProbed(true); return; }

    (async () => {
      // Cartoon/library characters preview an anchor — probe every profile and
      // take the first that has one, so the card shows a face as soon as ANY
      // age band is anchored.
      if (isCartoonOnly || isLibraryOnly) {
        const probes = await Promise.all(
          profiles.map((p) =>
            api.getAnchor(p.id).then((r) => (r.exists ? p.id : null)).catch(() => null),
          ),
        );
        if (!cancelled) setAnchorProfileId(probes.find((id) => id !== null) ?? null);
      }
      // Photoreal (or mixed / library) characters can fall back to a dataset image.
      if (!isCartoonOnly) {
        try {
          const r = await api.listImages(firstProfile.id);
          if (!cancelled) {
            setDatasetCount(r.count);
            const usable = r.images.find((i) => i.size > 50_000) ?? r.images[0];
            setPreviewFilename(usable?.filename ?? null);
          }
        } catch {
          if (!cancelled) setDatasetCount(0);
        }
      } else {
        if (!cancelled) setDatasetCount(0);
      }
      if (!cancelled) setProbed(true);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char.id]);

  const anchorExists = anchorProfileId !== null;
  const loraReady    = profiles.some((p) => !!p.loraPath);
  const target       = firstProfile?.targetImages ?? 0;
  const dcount       = datasetCount ?? 0;

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

  // Card links to the profile we preview (or the first one).
  const linkProfileId = anchorProfileId ?? firstProfile?.id ?? null;
  const href = linkProfileId ? `/characters/${linkProfileId}/description` : '#';
  const attachedProjects = char.projectLinks.map((l) => l.project.slug);

  // Age summary across profiles: «8 · 19 · 24 · 31» reads better than one band.
  const ages = profiles.map((p) => p.ageLabel).filter((a): a is string => !!a);
  const ageSummary = ages.length === 0
    ? '—'
    : ages.length === 1
      ? ages[0]
      : ages.map((a) => a.replace(/^\D*/, '') || a).join(' · ');

  return (
    <div className="group bg-zinc-900 border border-zinc-800 hover:border-blue-700 rounded-lg overflow-hidden transition flex flex-col">
      <Link href={href} className="block flex-1">
        <div className="aspect-square bg-zinc-950 relative">
          {/* Preview: anchor of the first anchored profile → dataset image → placeholder */}
          {anchorProfileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.anchorRawUrl(anchorProfileId)}
              alt={char.code}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : previewFilename && firstProfile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.imageUrl(firstProfile.id, previewFilename)}
              alt={char.code}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">
              {!probed
                ? '…'
                : (firstProfile
                    ? (isCartoonOnly ? 'нет anchor' : 'нет датасета')
                    : 'нет профиля')}
            </div>
          )}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded font-medium ${assetBadge.cls}`}>
              {assetBadge.label}
            </span>
            {profiles.length > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800/90 text-zinc-300 font-mono">
                {profiles.length} профиля
              </span>
            )}
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
            {profiles.length > 1
              ? profiles.map((p) => p.profileCode).join(', ')
              : (firstProfile?.profileCode ?? char.code)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <Stat label="профили" value={`${profiles.length}`} />
            <Stat label="возраст" value={ageSummary} />
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
