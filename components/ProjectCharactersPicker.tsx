'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';

type LibChar    = Awaited<ReturnType<typeof api.listLibraryCharacters>>[number];
type LibProfile = LibChar['profiles'][number];

/**
 * "Состав проекта" — same visual language as the global persona library list
 * (face preview + LoRA / dataset / attached-projects badges), with an attach
 * checkbox overlay that flips the M:N row in `project_characters` via the
 * attach/detach endpoints. No prompt / training UI here — those live at
 * `/characters/<profileId>`.
 */
export function ProjectCharactersPicker({ projectSlug }: { projectSlug: string }) {
  const [chars, setChars] = useState<LibChar[] | null>(null);
  const [busy, setBusy]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listLibraryCharacters();
      setChars(list);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL segment may be either project slug or project UUID — match either.
  const isAttached = (c: LibChar) =>
    c.projectLinks.some((l) => l.project.slug === projectSlug || l.project.id === projectSlug);

  const toggle = async (c: LibChar) => {
    setBusy(c.id); setError(null);
    try {
      if (isAttached(c)) {
        await api.detachCharacter(projectSlug, c.id);
      } else {
        await api.attachCharacter(projectSlug, c.id);
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (error && !chars) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!chars) return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;

  // Flatten character → profile cards (matches the global list). One card per
  // profile, with the character's attach checkbox at top-left.
  const cards: Array<{ char: LibChar; profile: LibProfile | null }> = [];
  for (const c of chars) {
    if (c.profiles.length === 0) cards.push({ char: c, profile: null });
    else for (const p of c.profiles) cards.push({ char: c, profile: p });
  }

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex justify-between items-baseline mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Состав проекта</h1>
          <p className="text-zinc-500 text-sm">
            Отметь персонажей которые участвуют в этом проекте. Промпты и тренировка — на{' '}
            <Link href="/characters" className="text-blue-400 hover:text-blue-300 underline">странице персонажей</Link>.
          </p>
        </div>
        <button onClick={refresh} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1">
          ↻ refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(({ char, profile }) => (
          <PickerCard
            key={profile ? profile.id : char.id}
            char={char}
            profile={profile}
            attached={isAttached(char)}
            busy={busy === char.id}
            onToggle={() => toggle(char)}
          />
        ))}
      </div>
    </main>
  );
}

function PickerCard({
  char, profile, attached, busy, onToggle,
}: {
  char: LibChar;
  profile: LibProfile | null;
  attached: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [datasetCount,    setDatasetCount]    = useState<number | null>(null);
  const [anchorExists,    setAnchorExists]    = useState<boolean>(false);

  // Style of every project this character is currently attached to — drives
  // which preview source (dataset vs anchor) to load and which badge to show.
  const styles = char.projectLinks.map((l) => l.project.visualStyle ?? 'photoreal_cinematic');
  const hasCartoon    = styles.some((s) => s !== 'photoreal_cinematic');
  const hasPhotoreal  = styles.some((s) => s === 'photoreal_cinematic');
  const isCartoonOnly = hasCartoon && !hasPhotoreal;
  const isLibraryOnly = styles.length === 0;

  useEffect(() => {
    if (!profile) return;
    if (isCartoonOnly || isLibraryOnly) {
      api.getAnchor(profile.id).then((r) => setAnchorExists(r.exists)).catch(() => setAnchorExists(false));
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

  const assetBadge: { label: string; cls: string } = isCartoonOnly
    ? (anchorExists
        ? { label: 'anchor готов', cls: 'bg-purple-700 text-purple-100' }
        : { label: 'нет anchor',   cls: 'bg-zinc-700 text-zinc-200' })
    : loraReady
      ? { label: 'LoRA готова', cls: 'bg-emerald-700 text-emerald-100' }
      : dcount === 0
        ? { label: 'нет датасета', cls: 'bg-zinc-700 text-zinc-200' }
        : target > 0 && dcount < target
          ? { label: `датасет ${dcount}/${target}`, cls: 'bg-yellow-700 text-yellow-100' }
          : { label: `датасет ${dcount}`, cls: 'bg-purple-700 text-purple-100' };

  const detailHref = profile ? `/characters/${profile.id}/description` : '#';

  return (
    <div className={`relative group bg-zinc-900 border rounded-lg overflow-hidden transition flex flex-col
      ${attached ? 'border-blue-700' : 'border-zinc-800 hover:border-zinc-600'}`}>
      <Link href={detailHref} className="block flex-1">
        <div className="aspect-square bg-zinc-950 relative">
          {/* Preview pick: cartoon-only → anchor PNG; photoreal → dataset; */}
          {profile && isCartoonOnly && anchorExists ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.anchorRawUrl(profile.id)}
              alt={profile.profileCode}
              className={`w-full h-full object-cover transition ${attached ? '' : 'opacity-60 group-hover:opacity-100'}`}
              loading="lazy"
            />
          ) : profile && isLibraryOnly && anchorExists && !previewFilename ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.anchorRawUrl(profile.id)}
              alt={profile.profileCode}
              className={`w-full h-full object-cover transition ${attached ? '' : 'opacity-60 group-hover:opacity-100'}`}
              loading="lazy"
            />
          ) : previewFilename && profile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.imageUrl(profile.id, previewFilename)}
              alt={profile.profileCode}
              className={`w-full h-full object-cover transition ${attached ? '' : 'opacity-60 group-hover:opacity-100'}`}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">
              {dcount > 0 ? '…' : (profile ? (isCartoonOnly ? 'нет anchor' : 'нет датасета') : 'нет профиля')}
            </div>
          )}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded font-medium ${assetBadge.cls}`}>
              {assetBadge.label}
            </span>
          </div>
        </div>
        <div className="p-4">
          <div className="font-medium">{char.displayName ?? char.code}</div>
          <div className="text-xs text-zinc-500 font-mono">
            {profile?.profileCode ?? char.code}
          </div>
        </div>
      </Link>

      {/* Attach checkbox sits above the link so toggling doesn't navigate. */}
      <label
        onClick={(e) => { e.stopPropagation(); }}
        className="absolute top-2 left-2 bg-zinc-950/80 backdrop-blur rounded px-2 py-1 flex items-center gap-2 cursor-pointer select-none border border-zinc-700"
        title={attached ? 'Убрать из проекта' : 'Добавить в проект'}
      >
        <input
          type="checkbox"
          checked={attached}
          disabled={busy}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-blue-500"
        />
        <span className="text-[11px] text-zinc-300">
          {busy ? '…' : (attached ? 'в проекте' : 'добавить')}
        </span>
      </label>
    </div>
  );
}
