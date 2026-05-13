'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, ProfileSummary, DashboardResponse } from '../lib/api';
import { CreateCharacterModal } from './CreateCharacterModal';
import { DeleteCharacterModal } from './DeleteCharacterModal';

const POLL_MS = 5000;

/**
 * Compound status: the single `phase` enum from the backend can't express e.g.
 * "has LoRA + queued for new dataset" or "has dataset partially". We derive two
 * orthogonal badges instead:
 *   1. asset badge — what's already produced (none / dataset partial / dataset
 *      ready / LoRA ready)
 *   2. job badge — what's queued or running (dataset queued/running, training
 *      queued/running). Shown only when there's an active job.
 */
type Badge = { label: string; cls: string };

function assetBadge(p: ProfileSummary): Badge {
  if (p.loraReady) return { label: 'LoRA готова',     cls: 'bg-emerald-700 text-emerald-100' };
  const target = p.targetImages ?? 0;
  if (p.datasetCount === 0)       return { label: 'нет датасета',  cls: 'bg-zinc-700 text-zinc-200' };
  if (target > 0 && p.datasetCount < target)
    return { label: `датасет ${p.datasetCount}/${target}`, cls: 'bg-yellow-700 text-yellow-100' };
  return { label: `датасет ${p.datasetCount}`, cls: 'bg-purple-700 text-purple-100' };
}

function jobBadge(p: ProfileSummary): Badge | null {
  const t = p.lastTrainingJob;
  if (t && (t.status === 'preparing' || t.status === 'captioning' || t.status === 'training')) {
    return { label: 'обучается', cls: 'bg-orange-700 text-orange-100' };
  }
  if (t && (t.status === 'pending' || t.status === 'blocked')) {
    return { label: 'тренировка в очереди', cls: 'bg-amber-700 text-amber-100' };
  }
  const d = p.lastDatasetJob;
  if (d && d.status === 'running') {
    return { label: 'датасет генерируется', cls: 'bg-blue-700 text-blue-100' };
  }
  if (d && (d.status === 'pending' || d.status === 'blocked')) {
    return { label: 'датасет в очереди', cls: 'bg-amber-700 text-amber-100' };
  }
  return null;
}

export function CharactersList({ id }: { id: string }) {
  const [data, setData]   = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate]                 = useState(false);
  const [deleteCharacter, setDeleteCharacter]       = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.dashboard(id);
      setData(d);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (error && !data) {
    return (
      <main className="px-8 py-6 max-w-7xl mx-auto">
        <div className="bg-red-900/40 border border-red-700 rounded p-4">
          <p className="text-red-200 font-mono text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return <main className="px-8 py-6 max-w-7xl mx-auto text-zinc-500">Loading…</main>;
  }

  return (
    <main className="px-8 py-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Персонажи ({data.profiles.length})</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded"
          >
            + новый персонаж
          </button>
          <button onClick={refresh} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1">
            ↻ refresh
          </button>
        </div>
      </div>

      {showCreate && (
        <CreateCharacterModal
          projectId={id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data.profiles.map((p) => (
          <CharacterCard
            key={p.profileId}
            projectId={id}
            profile={p}
            onDelete={() => setDeleteCharacter(p.characterId)}
          />
        ))}
      </div>

      {deleteCharacter && (
        <DeleteCharacterModal
          projectId={id}
          characterId={deleteCharacter}
          onClose={() => setDeleteCharacter(null)}
          onDeleted={() => { setDeleteCharacter(null); refresh(); }}
        />
      )}
    </main>
  );
}

function CharacterCard({
  projectId, profile, onDelete,
}: {
  projectId: string;
  profile:   ProfileSummary;
  onDelete:  () => void;
}) {
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);

  useEffect(() => {
    if (profile.datasetCount === 0) return;
    api.listImages(profile.profileId)
      .then((r) => {
        const usable = r.images.find((i) => i.size > 50_000) ?? r.images[0];
        setPreviewFilename(usable?.filename ?? null);
      })
      .catch(() => {});
  }, [profile.profileId, profile.datasetCount]);

  return (
    <div className="group bg-zinc-900 border border-zinc-800 hover:border-blue-700 rounded-lg overflow-hidden transition flex flex-col relative">
      <Link
        href={`/projects/${projectId}/characters/${profile.profileId}`}
        className="block flex-1"
      >
        <div className="aspect-square bg-zinc-950 relative">
          {previewFilename ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.imageUrl(profile.profileId, previewFilename)}
              alt={profile.profileCode}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">
              {profile.datasetCount > 0 ? '…' : 'нет датасета'}
            </div>
          )}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {(() => {
              const a = assetBadge(profile);
              const j = jobBadge(profile);
              return (
                <>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${a.cls}`}>{a.label}</span>
                  {j && <span className={`text-xs px-2 py-1 rounded font-medium ${j.cls}`}>{j.label}</span>}
                </>
              );
            })()}
          </div>
        </div>
        <div className="p-4">
          <div className="font-medium">{profile.displayName ?? profile.profileCode}</div>
          <div className="text-xs text-zinc-500 font-mono mb-3">{profile.profileCode}</div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <Stat label="датасет" value={`${profile.datasetCount}`} />
            <Stat label="возраст" value={profile.ageLabel ?? '—'} />
            <Stat label="LoRA"    value={profile.loraReady ? 'yes' : '—'} />
          </div>
        </div>
      </Link>

      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="absolute top-2 left-2 bg-red-600/80 hover:bg-red-500 text-white text-xs w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
        title="Удалить персонажа"
      >
        ✕
      </button>
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
