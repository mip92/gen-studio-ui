'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, DatasetImage } from '../lib/api';
import { useCharacterCtx } from './CharacterPageShell';
import { Field, Choices, Radio, Thumbnail, Lightbox } from './CharacterDetail';

interface OtherProfile {
  profileId:    string;
  profileCode:  string;
  characterCode: string;
  displayName:  string | null;
}

export function CharacterDatasetTab() {
  const { profile, profileId, refresh } = useCharacterCtx();

  const [images, setImages]                     = useState<DatasetImage[]>([]);
  const [busy,   setBusy]                       = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx]           = useState<number | null>(null);

  const [refMode,       setRefMode]       = useState<'self' | 'chain'>('self');
  const [refProfileId,  setRefProfileId]  = useState<string>('');
  const [refImage,      setRefImage]      = useState<string>('');
  const [refImageList,  setRefImageList]  = useState<DatasetImage[]>([]);
  const [waitMode,      setWaitMode]      = useState<'now' | 'after'>('now');
  const [waitProfileId, setWaitProfileId] = useState<string>('');

  // Chain/depends-on pickers see the whole persona library (a profile from any
  // character anywhere can serve as a chained reference). Previously this list
  // was project-scoped via dashboard.profiles — that's stale; characters are
  // now project-independent.
  const [otherProfiles, setOtherProfiles] = useState<OtherProfile[]>([]);
  useEffect(() => {
    api.listLibraryCharacters()
      .then((chars) => {
        const all: OtherProfile[] = [];
        for (const c of chars) {
          for (const p of c.profiles) {
            if (p.id === profileId) continue;
            all.push({
              profileId:     p.id,
              profileCode:   p.profileCode,
              characterCode: c.code,
              displayName:   c.displayName,
            });
          }
        }
        setOtherProfiles(all);
      })
      .catch(() => setOtherProfiles([]));
  }, [profileId]);
  // No cheap way to know dataset count in bulk; pickers below show all profiles
  // and the backend rejects with a clear error if the chained source has no
  // images at dispatch time.
  const profilesWithDataset = otherProfiles;

  const loadImages = useCallback(async () => {
    try {
      const r = await api.listImages(profileId);
      setImages(r.images);
    } catch { /* ignore */ }
  }, [profileId]);

  useEffect(() => { loadImages(); }, [loadImages]);

  // Pull reference profile's images for the picker when chain mode is on.
  useEffect(() => {
    if (refMode !== 'chain' || !refProfileId) {
      setRefImageList([]);
      return;
    }
    api.listImages(refProfileId)
      .then((r) => setRefImageList(r.images))
      .catch(() => setRefImageList([]));
    setRefImage('');
  }, [refMode, refProfileId]);

  const handleEnqueue = async () => {
    setBusy('enqueue');
    try {
      await api.enqueueDataset(profileId, {
        referenceProfileId:     refMode === 'chain' && refProfileId ? refProfileId : undefined,
        referenceImageFilename: refMode === 'chain' && refImage    ? refImage    : undefined,
        dependsOnProfileId:     waitMode === 'after' && waitProfileId ? waitProfileId : undefined,
      });
      await refresh();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const cancelDataset = async () => {
    if (!profile.lastDatasetJob) return;
    if (!confirm('Отменить активный job генерации датасета?')) return;
    setBusy('cancel');
    try {
      await api.cancelDatasetJob(profile.lastDatasetJob.id);
      await refresh();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const handleDelete = async (filename: string) => {
    setBusy('delete:' + filename);
    try {
      await api.deleteImage(profileId, filename);
      setImages((prev) => prev.filter((i) => i.filename !== filename));
      await refresh();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const dsActive = !!profile.lastDatasetJob && ['pending','blocked','running'].includes(profile.lastDatasetJob.status);
  const trActive = !!profile.lastTrainingJob && !['completed','failed','cancelled'].includes(profile.lastTrainingJob.status);
  const dsLabel  = !dsActive ? '+ генерировать датасет'
                 : profile.lastDatasetJob!.status === 'pending' ? '⏳ в очереди…'
                 : profile.lastDatasetJob!.status === 'blocked' ? '⌛ ждёт зависимость…'
                 : `⚙ генерируется… (${profile.datasetCount} картинок)`;

  return (
    <main className="px-4 sm:px-8 py-6">
      {/* Generate dataset */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Сгенерировать датасет</h2>

        <Field label="Источник reference">
          <Choices>
            <Radio checked={refMode === 'self'} onChange={() => setRefMode('self')}>
              свой <code className="text-zinc-500">reference/{profile.profileCode}/</code>
            </Radio>
            <Radio checked={refMode === 'chain'} onChange={() => setRefMode('chain')} disabled={profilesWithDataset.length === 0}>
              взять из другого профиля
            </Radio>
            {refMode === 'chain' && (
              <select value={refProfileId} onChange={(e) => setRefProfileId(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs">
                <option value="">— выбери —</option>
                {profilesWithDataset.map((p) => (
                  <option key={p.profileId} value={p.profileId}>{p.characterCode} · {p.profileCode}</option>
                ))}
              </select>
            )}
          </Choices>

          {refMode === 'chain' && refProfileId && (
            <div className="mt-3">
              <div className="text-xs text-zinc-500 mb-2">
                Выбери конкретное изображение (или оставь авто-выбор):
                {refImage && <span className="ml-2 text-emerald-400 font-mono">✓ {refImage}</span>}
              </div>
              {refImageList.length === 0 ? (
                <p className="text-xs text-zinc-600">У этого профиля ещё нет картинок в COMFY_OUTPUT.</p>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-10 gap-1 max-h-64 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div
                    role="button"
                    onClick={() => setRefImage('')}
                    className={`aspect-square border rounded text-[10px] flex items-center justify-center text-center cursor-pointer ${refImage === '' ? 'border-emerald-500 bg-emerald-900/30 text-emerald-200' : 'border-zinc-700 text-zinc-500 hover:bg-zinc-800'}`}
                  >
                    авто
                  </div>
                  {refImageList.filter((i) => i.size > 50_000).map((img) => (
                    <div
                      key={img.filename}
                      role="button"
                      onClick={() => setRefImage(img.filename)}
                      className={`aspect-square border rounded overflow-hidden cursor-pointer ${refImage === img.filename ? 'border-emerald-500 ring-2 ring-emerald-500/50' : 'border-zinc-800 hover:border-zinc-600'}`}
                      title={img.filename}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={api.imageUrl(refProfileId, img.filename)}
                        alt={img.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>

        <Field label="Когда запускать">
          <Choices>
            <Radio checked={waitMode === 'now'} onChange={() => setWaitMode('now')}>сразу</Radio>
            <Radio checked={waitMode === 'after'} onChange={() => setWaitMode('after')}>после готовности</Radio>
            {waitMode === 'after' && (
              <select value={waitProfileId} onChange={(e) => setWaitProfileId(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs">
                <option value="">— выбери —</option>
                {otherProfiles.map((p) => (
                  <option key={p.profileId} value={p.profileId}>{p.profileCode}</option>
                ))}
              </select>
            )}
          </Choices>
        </Field>

        <div className="flex gap-2 flex-wrap pt-2 items-center">
          <button
            onClick={handleEnqueue}
            disabled={busy !== null || dsActive || trActive}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded min-w-[260px]"
          >
            {busy === 'enqueue' ? '…' : dsLabel}
          </button>
          {dsActive && (
            <button
              onClick={cancelDataset}
              disabled={busy !== null}
              className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded px-3 py-2"
              title="Отменить текущий job"
            >
              {busy === 'cancel' ? '…' : '✕ отменить'}
            </button>
          )}
          <button onClick={loadImages} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-2">
            ↻
          </button>
          {dsActive && (
            <span className="text-xs text-zinc-500 ml-2">обновляется каждые 5 сек</span>
          )}
        </div>
      </section>

      {/* Images grid */}
      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Датасет ({images.length})
        </h2>

        {images.length === 0 && (
          <p className="text-zinc-500 text-sm">Нет картинок. Запусти генерацию чтобы они появились в COMFY_OUTPUT.</p>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {images.map((img, idx) => (
            <Thumbnail
              key={img.filename}
              profileId={profileId}
              image={img}
              busy={busy === 'delete:' + img.filename}
              onOpen={() => setLightboxIdx(idx)}
              onDelete={() => handleDelete(img.filename)}
            />
          ))}
        </div>
      </section>

      {lightboxIdx !== null && (
        <Lightbox
          profileId={profileId}
          images={images}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
          onDelete={async (filename) => {
            await handleDelete(filename);
            setLightboxIdx((i) => {
              if (i === null) return null;
              const newLen = images.length - 1;
              if (newLen === 0) return null;
              return Math.min(i, newLen - 1);
            });
          }}
        />
      )}
    </main>
  );
}
