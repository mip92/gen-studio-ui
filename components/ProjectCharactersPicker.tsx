'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { AddCharacterToProjectModal } from './AddCharacterToProjectModal';

type ProjChar = Awaited<ReturnType<typeof api.listCharacters>>[number];
type Profile  = ProjChar['profiles'][number];

/**
 * "Состав проекта" — shows ONLY the characters attached to this project
 * (face preview + LoRA / dataset / anchor badges). Attaching happens through
 * the search modal («＋ добавить») so the full persona library is never loaded
 * on this page; detaching is the ✕ button on each card. Prompt / training UI
 * lives at `/characters/<profileId>`.
 */
export function ProjectCharactersPicker({ projectSlug }: { projectSlug: string }) {
  const [chars, setChars]   = useState<ProjChar[] | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listCharacters(projectSlug);
      setChars(list);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectSlug]);

  useEffect(() => { void refresh(); }, [refresh]);

  const detach = async (c: ProjChar) => {
    if (!window.confirm(`Убрать «${c.displayName ?? c.code}» из проекта? Персонаж останется в библиотеке.`)) return;
    setBusy(c.id); setError(null);
    try {
      await api.detachCharacter(projectSlug, c.id);
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

  // Flatten character → profile cards. One card per profile.
  const cards: Array<{ char: ProjChar; profile: Profile | null }> = [];
  for (const c of chars) {
    if (c.profiles.length === 0) cards.push({ char: c, profile: null });
    else for (const p of c.profiles) cards.push({ char: c, profile: p });
  }

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="flex justify-between items-baseline mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Состав проекта</h1>
          <p className="text-zinc-500 text-sm">
            Персонажи, назначенные на этот проект. Промпты и тренировка — на{' '}
            <Link href="/characters" className="text-blue-400 hover:text-blue-300 underline">странице персонажей</Link>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded"
          >
            ＋ добавить персонажа
          </button>
          <button onClick={refresh} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-2">
            ↻ refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs mb-4">
          {error}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="border border-dashed border-zinc-700 rounded-lg p-10 text-center text-zinc-500">
          В проекте пока нет персонажей — нажми «＋ добавить персонажа» и найди нужного по имени.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map(({ char, profile }) => (
            <CastCard
              key={profile ? profile.id : char.id}
              char={char}
              profile={profile}
              busy={busy === char.id}
              onDetach={() => detach(char)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddCharacterToProjectModal
          projectSlug={projectSlug}
          attachedIds={new Set(chars.map((c) => c.id))}
          onClose={() => setShowAdd(false)}
          onAttached={() => { void refresh(); }}
        />
      )}
    </main>
  );
}

function CastCard({
  char, profile, busy, onDetach,
}: {
  char:     ProjChar;
  profile:  Profile | null;
  busy:     boolean;
  onDetach: () => void;
}) {
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [datasetCount,    setDatasetCount]    = useState<number | null>(null);
  const [anchorExists,    setAnchorExists]    = useState<boolean>(false);

  // Style of every project this character is attached to — drives which
  // preview source (dataset vs anchor) to load and which badge to show.
  const styles = (char.projectLinks ?? []).map((l) => l.project.visualStyle ?? 'photoreal_cinematic');
  const hasCartoon    = styles.some((s) => s !== 'photoreal_cinematic');
  const hasPhotoreal  = styles.some((s) => s === 'photoreal_cinematic');
  const isCartoonOnly = hasCartoon && !hasPhotoreal;

  useEffect(() => {
    if (!profile) return;
    if (isCartoonOnly) {
      api.getAnchor(profile.id).then((r) => setAnchorExists(r.exists)).catch(() => setAnchorExists(false));
      setDatasetCount(0);
    } else {
      api.listImages(profile.id)
        .then((r) => {
          setDatasetCount(r.count);
          const usable = r.images.find((i) => i.size > 50_000) ?? r.images[0];
          setPreviewFilename(usable?.filename ?? null);
        })
        .catch(() => { setDatasetCount(0); });
    }
  }, [profile, isCartoonOnly]);

  const loraReady = !!profile?.loraPath;
  const dcount    = datasetCount ?? 0;

  const assetBadge: { label: string; cls: string } = isCartoonOnly
    ? (anchorExists
        ? { label: 'anchor готов', cls: 'bg-purple-700 text-purple-100' }
        : { label: 'нет anchor',   cls: 'bg-zinc-700 text-zinc-200' })
    : loraReady
      ? { label: 'LoRA готова', cls: 'bg-emerald-700 text-emerald-100' }
      : dcount === 0
        ? { label: 'нет датасета', cls: 'bg-zinc-700 text-zinc-200' }
        : { label: `датасет ${dcount}`, cls: 'bg-purple-700 text-purple-100' };

  const detailHref = profile ? `/characters/${profile.id}/description` : '#';

  return (
    <div className="relative group bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-lg overflow-hidden transition flex flex-col">
      <Link href={detailHref} className="block flex-1">
        <div className="aspect-square bg-zinc-950 relative">
          {profile && isCartoonOnly && anchorExists ? (
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

      {/* Detach sits above the link so clicking it doesn't navigate. */}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDetach(); }}
        title="Убрать из проекта (персонаж останется в библиотеке)"
        className="absolute top-2 left-2 bg-zinc-950/80 backdrop-blur rounded px-2 py-1 text-[11px] text-zinc-400
          hover:text-red-300 hover:border-red-800 border border-zinc-700 opacity-0 group-hover:opacity-100 transition"
      >
        {busy ? '…' : '✕ убрать'}
      </button>
    </div>
  );
}
