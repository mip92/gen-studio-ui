'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { api, ProfileSummary, DashboardResponse, DatasetImage, ProfileFull, UpdateProfileBody } from '../lib/api';

const POLL_MS = 5000;

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

export function CharacterDetail({
  projectId,
  profileId,
}: {
  projectId: string;
  profileId: string;
}) {
  const [data,         setData]        = useState<DashboardResponse | null>(null);
  const [profileFull,  setProfileFull] = useState<ProfileFull | null>(null);
  const [images,       setImages]      = useState<DatasetImage[]>([]);
  const [error,        setError]       = useState<string | null>(null);
  const [busy,         setBusy]        = useState<string | null>(null);
  const [lightboxIdx,  setLightboxIdx] = useState<number | null>(null);

  const [refMode,        setRefMode]       = useState<'self' | 'chain'>('self');
  const [refProfileId,   setRefProfileId]  = useState<string>('');
  const [refImage,       setRefImage]      = useState<string>('');         // chosen filename within ref profile
  const [refImageList,   setRefImageList]  = useState<DatasetImage[]>([]);
  const [waitMode,       setWaitMode]      = useState<'now' | 'after'>('now');
  const [waitProfileId,  setWaitProfileId] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const d = await api.dashboard(projectId);
      setData(d);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  const loadImages = useCallback(async () => {
    try {
      const r = await api.listImages(profileId);
      setImages(r.images);
    } catch { /* ignore */ }
  }, [profileId]);

  const loadProfile = useCallback(async () => {
    try {
      const p = await api.getProfile(profileId);
      setProfileFull(p);
    } catch { /* ignore */ }
  }, [profileId]);

  useEffect(() => { refresh(); loadImages(); loadProfile(); }, [refresh, loadImages, loadProfile]);

  // Load chosen reference profile's images for the picker
  useEffect(() => {
    if (refMode !== 'chain' || !refProfileId) {
      setRefImageList([]);
      return;
    }
    api.listImages(refProfileId)
      .then((r) => setRefImageList(r.images))
      .catch(() => setRefImageList([]));
    setRefImage(''); // reset selection when profile changes
  }, [refMode, refProfileId]);
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (error)         return <Pad><Err msg={error} /></Pad>;
  if (!data)         return <Pad><p className="text-zinc-500">Loading…</p></Pad>;

  const profile = data.profiles.find((p) => p.profileId === profileId);
  if (!profile)      return <Pad><Err msg={`Profile ${profileId} not found`} /></Pad>;

  const otherProfiles       = data.profiles.filter((p) => p.profileId !== profileId);
  const profilesWithDataset = otherProfiles.filter((p) => p.datasetCount > 0);

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

  const handleTrain = async () => {
    if (!confirm(`Запустить тренировку LoRA для ${profile.profileCode}?\n\nДатасет: ${profile.datasetCount} картинок.`)) return;
    setBusy('train');
    try {
      await api.startTraining(profileId, { numRepeats: 10, maxSteps: 1500, networkDim: 32 });
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

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <Link href={`/projects/${projectId}/characters`} className="text-zinc-500 hover:text-zinc-200 text-sm mb-4 inline-block">
        ← все персонажи
      </Link>

      <header className="mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="text-2xl font-semibold">{profile.displayName ?? profile.profileCode}</h1>
          <span className={`text-xs px-3 py-1 rounded font-medium ${PHASE_COLOR[profile.phase]}`}>
            {PHASE_LABEL[profile.phase]}
          </span>
        </div>
        <p className="text-zinc-500 text-sm font-mono">{profile.profileCode}</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="датасет" value={`${profile.datasetCount} img`} />
        <Stat label="возраст" value={profile.ageLabel ?? '—'} />
        <Stat label="триггер" value={profile.triggerToken ?? '—'} mono />
        <Link
          href={`/projects/${projectId}/characters/${profileId}/loras`}
          className={`text-left rounded-lg border p-3 transition block
            ${profile.loraReady
              ? 'bg-emerald-900/20 border-emerald-800 hover:border-emerald-600'
              : 'bg-zinc-900    border-zinc-800   hover:border-zinc-600'}`}
          title="Открыть библиотеку LoRA"
        >
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">LoRA</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-mono text-sm ${profile.loraReady ? 'text-emerald-200' : 'text-zinc-300'}`}>
              {profile.loraReady ? `${profile.loraSizeMB} MB` : '—'}
            </span>
            <span className="text-[10px] text-zinc-500">
              {(profileFull?.loraVariants?.length ?? 0) > 0
                ? `${profileFull!.loraVariants!.length} вар. →`
                : 'управление →'}
            </span>
          </div>
        </Link>
      </section>

      <TrainingProgress trainingJob={profile.lastTrainingJob} />

      <ReferenceUploader profileId={profileId} />

      {profileFull && (
        <ProfileDescription
          profile={profileFull}
          onSaved={(updated) => {
            setProfileFull(updated);
            refresh();
          }}
        />
      )}

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
                  <option key={p.profileId} value={p.profileId}>{p.profileCode} ({p.datasetCount})</option>
                ))}
              </select>
            )}
          </Choices>

          {refMode === 'chain' && refProfileId && (
            <div className="mt-3">
              <div className="text-xs text-zinc-500 mb-2">
                Выбери конкретный кадр (или оставь авто-выбор):
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

        {(() => {
          const dsActive = !!profile.lastDatasetJob && ['pending','blocked','running'].includes(profile.lastDatasetJob.status);
          const trActive = !!profile.lastTrainingJob && !['completed','failed','cancelled'].includes(profile.lastTrainingJob.status);
          const dsLabel  = !dsActive ? '+ генерировать датасет'
                         : profile.lastDatasetJob!.status === 'pending' ? '⏳ в очереди…'
                         : profile.lastDatasetJob!.status === 'blocked' ? '⌛ ждёт зависимость…'
                         : `⚙ генерируется… (${profile.datasetCount} картинок)`;
          const trLabel  = !trActive ? '⚙ обучить LoRA'
                         : `⚙ обучается… (${profile.lastTrainingJob!.status})`;
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
          return (
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
                  title="Отменить текущий job (если ComfyUI зависла или была остановлена вручную)"
                >
                  {busy === 'cancel' ? '…' : '✕ отменить'}
                </button>
              )}
              <button
                onClick={handleTrain}
                disabled={busy !== null || profile.datasetCount === 0 || dsActive || trActive}
                className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
              >
                {busy === 'train' ? '…' : trLabel}
              </button>
              <button onClick={loadImages} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-2">
                ↻
              </button>
              {(dsActive || trActive) && (
                <span className="text-xs text-zinc-500 ml-2">обновляется каждые 5 сек</span>
              )}
            </div>
          );
        })()}
      </section>

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
            // Adjust lightbox index after deletion
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

// ── Training progress ───────────────────────────────────────────────────────

function TrainingProgress({
  trainingJob,
}: {
  trainingJob: ProfileSummary['lastTrainingJob'];
}) {
  const [progress, setProgress] = useState<Awaited<ReturnType<typeof api.trainingProgress>> | null>(null);

  const isActive = !!trainingJob && !['completed', 'failed', 'cancelled'].includes(trainingJob.status);
  const jobId = trainingJob?.id;

  useEffect(() => {
    if (!isActive || !jobId) { setProgress(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const p = await api.trainingProgress(jobId);
        if (!cancelled) setProgress(p);
      } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isActive, jobId]);

  if (!trainingJob) return null;

  const phase     = progress?.phase ?? trainingJob.status;
  const phaseLabel: Record<string, string> = {
    pending:    '⏳ в очереди',
    preparing:  '📦 подготовка датасета',
    captioning: '✍ Florence-2 пишет подписи',
    training:   '⚙ kohya обучает LoRA',
    completed:  '✓ готово',
    failed:     '✕ упало',
    cancelled:  '⊘ отменено',
  };
  const isFailed   = phase === 'failed' || phase === 'cancelled';
  const isFinished = phase === 'completed';

  if (!isActive && !isFinished && !isFailed) return null;

  const stuckThresholdMs = phase === 'captioning' ? 5 * 60 * 1000 : 60 * 60 * 1000;
  const looksStuck = isActive && !!progress?.elapsedMs && progress.elapsedMs > stuckThresholdMs;
  const handleCancel = async () => {
    if (!trainingJob || !confirm(`Принудительно отменить тренировку?\n\nИспользуй если процесс застрял — backend перезапускался или Florence-2 / kohya упали.`)) return;
    try {
      await api.cancelTraining(trainingJob.id);
      setProgress(null);
      // Force a parent refresh by clearing — caller's polling will pick up new state
      window.location.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Тренировка LoRA</h2>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${isFinished ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300'}`}>
            {phaseLabel[phase] ?? phase}
          </span>
          {isActive && (
            <button
              onClick={handleCancel}
              className={`text-xs border rounded px-2 py-0.5 ${looksStuck ? 'border-red-700 text-red-300 hover:bg-red-950/50' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
              title={looksStuck ? 'Job похож на зависший — рекомендуется отменить' : 'Отменить тренировку'}
            >
              ✕ отменить{looksStuck ? ' (zombie?)' : ''}
            </button>
          )}
        </div>
      </header>

      {trainingJob.error && (
        <div className="text-xs text-red-300 bg-red-900/30 border border-red-900/50 rounded p-2 mb-3 font-mono break-words">
          {trainingJob.error}
        </div>
      )}

      {progress && progress.step !== null && progress.totalSteps !== null && (
        <>
          <div className="flex items-baseline justify-between mb-1.5 text-xs">
            <span className="text-zinc-300 font-mono">
              шаг <span className="text-zinc-100">{progress.step}</span> / {progress.totalSteps}
            </span>
            <span className="text-zinc-400 font-mono">
              {progress.percent != null ? `${Math.round(progress.percent * 100)}%` : ''}
              {progress.avgLoss != null && <span className="ml-3">loss <span className="text-zinc-200">{progress.avgLoss.toFixed(3)}</span></span>}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${(progress.percent ?? 0) * 100}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between mt-1.5 text-[11px] text-zinc-500 font-mono">
            <span>прошло: {progress.elapsed ?? '—'}</span>
            <span>осталось: {progress.eta ?? '—'}</span>
          </div>
        </>
      )}

      {/* Captioning / preparing phases — no step info, just spinner-state */}
      {progress && progress.step === null && isActive && (
        <div className="text-xs text-zinc-400">
          {phase === 'captioning' && 'Florence-2 пишет подписи к каждому кадру датасета. Это ~1–3 минуты на 60 картинок при первом запуске (модель ~1 ГБ скачивается с HF).'}
          {phase === 'preparing' && 'Копируем кадры из ComfyUI/output в kohya-папку.'}
          {phase === 'training' && 'kohya грузит модель и кэширует латенты, скоро пойдут шаги…'}
          {phase === 'pending'  && 'Ждём свободного слота.'}
          {progress.elapsedMs != null && <span className="ml-2">({Math.round(progress.elapsedMs / 1000)} сек)</span>}
        </div>
      )}

      {progress?.lastLine && (
        <details className="mt-3">
          <summary className="text-[10px] text-zinc-600 cursor-pointer hover:text-zinc-400">последняя строка лога</summary>
          <pre className="text-[10px] text-zinc-500 font-mono mt-1 whitespace-pre-wrap break-all">{progress.lastLine}</pre>
        </details>
      )}
    </section>
  );
}

// ── Reference image uploader ────────────────────────────────────────────────

function ReferenceUploader({ profileId }: { profileId: string }) {
  type Info =
    | { exists: false; profileCode: string }
    | { exists: true;  profileCode: string; filename: string; size: number; mtime: number };

  const [info,    setInfo]    = useState<Info | null>(null);
  const [busy,    setBusy]    = useState<'upload' | 'delete' | null>(null);
  const [bust,    setBust]    = useState(Date.now());
  const [error,   setError]   = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.referenceInfo(profileId);
      setInfo(r);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File) => {
    setBusy('upload'); setError(null);
    try {
      await api.uploadReference(profileId, file);
      setBust(Date.now());
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить текущий reference?')) return;
    setBusy('delete'); setError(null);
    try {
      await api.deleteReference(profileId);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Reference image</h2>

      <div className="flex gap-4 items-start">
        <div className="w-32 h-32 bg-zinc-950 border border-zinc-800 rounded overflow-hidden flex-shrink-0">
          {info?.exists ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.referenceUrl(profileId, bust)}
              alt="reference"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs text-center px-2">
              нет<br/>reference
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {info?.exists ? (
            <div className="text-xs text-zinc-400 space-y-0.5 mb-3 font-mono">
              <div>{info.filename}</div>
              <div>{Math.round(info.size / 1024)} KB</div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 mb-3">
              Картинка-исходник для генерации датасета. Подаётся в ComfyUI как LoadImage.
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded"
            >
              {busy === 'upload' ? 'загрузка…' : info?.exists ? '↑ заменить' : '↑ загрузить'}
            </button>
            {info?.exists && (
              <button
                onClick={handleDelete}
                disabled={busy !== null}
                className="text-xs text-zinc-400 hover:text-red-400 border border-zinc-700 rounded px-3 py-1.5"
              >
                {busy === 'delete' ? '…' : 'удалить'}
              </button>
            )}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-400 font-mono">{error}</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Small UI primitives ─────────────────────────────────────────────────────

function Pad({ children }: { children: React.ReactNode }) {
  return <main className="px-8 py-6 max-w-7xl mx-auto">{children}</main>;
}
function Err({ msg }: { msg: string }) {
  return (
    <div className="bg-red-900/40 border border-red-700 rounded p-4">
      <p className="text-red-200 font-mono text-sm">{msg}</p>
    </div>
  );
}
function Stat({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded p-3 ${highlight ? 'border-emerald-700/60' : ''}`}>
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`text-zinc-200 ${mono ? 'font-mono text-xs' : 'text-base font-medium'} mt-0.5 truncate`}>{value}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
function Choices({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 text-xs flex-wrap items-center">{children}</div>;
}
function Radio({
  checked, onChange, disabled, children,
}: {
  checked:   boolean;
  onChange:  () => void;
  disabled?: boolean;
  children:  React.ReactNode;
}) {
  return (
    <label className={`flex items-center gap-1 cursor-pointer ${disabled ? 'opacity-30' : ''}`}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} />
      <span>{children}</span>
    </label>
  );
}
function Thumbnail({
  profileId, image, busy, onOpen, onDelete,
}: {
  profileId: string;
  image:     DatasetImage;
  busy:      boolean;
  onOpen:    () => void;
  onDelete:  () => void;
}) {
  const tooSmall = image.size < 50_000;
  return (
    <div className="relative group bg-zinc-900 border border-zinc-800 rounded overflow-hidden aspect-square cursor-zoom-in"
      onClick={onOpen}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={api.imageUrl(profileId, image.filename)} alt={image.filename}
        className="w-full h-full object-cover" loading="lazy" />
      {tooSmall && (
        <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center text-xs text-red-100">
          битый ({Math.round(image.size / 1024)} KB)
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={busy}
        className="absolute top-1 right-1 bg-red-600 hover:bg-red-500 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 disabled:opacity-50 transition"
        title="Удалить"
      >
        {busy ? '…' : '✕'}
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent text-[9px] text-zinc-300 font-mono px-1 py-0.5 truncate pointer-events-none">
        {image.filename.replace(/^.+_(\d+)_\.png$/, '#$1')}
      </div>
    </div>
  );
}

// ── Lightbox: full-size gallery with keyboard nav ───────────────────────────

function Lightbox({
  profileId, images, index, onClose, onNavigate, onDelete,
}: {
  profileId:  string;
  images:     DatasetImage[];
  index:      number;
  onClose:    () => void;
  onNavigate: (i: number) => void;
  onDelete:   (filename: string) => void;
}) {
  const cur = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      onClose();
      else if (e.key === 'ArrowLeft' && index > 0)              onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onNavigate]);

  if (!cur) return null;

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
        <div className="text-zinc-400 text-xs font-mono">
          {index + 1} / {images.length} · {cur.filename} · {Math.round(cur.size / 1024)} KB
        </div>
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Удалить ${cur.filename}?`)) onDelete(cur.filename);
            }}
            className="text-xs bg-red-700/80 hover:bg-red-600 text-white px-3 py-1 rounded"
          >
            ✕ удалить
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-xs bg-zinc-800/80 hover:bg-zinc-700 text-white px-3 py-1 rounded"
          >
            ESC
          </button>
        </div>
      </div>

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={api.imageUrl(profileId, cur.filename)}
        alt={cur.filename}
        className="max-w-[95vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Prev */}
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl bg-black/50 hover:bg-black/80 rounded-full w-12 h-12 flex items-center justify-center"
        >‹</button>
      )}

      {/* Next */}
      {index < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl bg-black/50 hover:bg-black/80 rounded-full w-12 h-12 flex items-center justify-center"
        >›</button>
      )}
    </div>
  );
}

// ── Profile description: read-only view + edit mode ─────────────────────────

const FIELDS: Array<{
  key:     keyof UpdateProfileBody;
  label:   string;
  type:    'text' | 'number' | 'multiline';
  hint?:   string;
}> = [
  { key: 'promptBase',    label: 'Описание (positive prompt)', type: 'multiline', hint: 'Подставляется в каждый кадр датасета' },
  { key: 'negative',      label: 'Negative prompt',            type: 'multiline' },
  { key: 'promptAngles',  label: 'Angles prompts',             type: 'multiline', hint: 'Список ракурсов через перевод строки' },
  { key: 'promptVariety', label: 'Variety prompts',            type: 'multiline', hint: 'Вариативность одежды/фона/света' },
  { key: 'ageLabel',      label: 'Возраст',                    type: 'text' },
  { key: 'targetImages',  label: 'Target images',              type: 'number',    hint: 'Сколько кадров за один прогон' },
  { key: 'triggerToken',  label: 'Trigger token',              type: 'text',      hint: 'Уникальное «слово» для LoRA' },
];

function ProfileDescription({
  profile, onSaved,
}: {
  profile: ProfileFull;
  onSaved: (updated: ProfileFull) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState<UpdateProfileBody>({});
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const startEdit = () => {
    setDraft({
      promptBase:    profile.promptBase    ?? '',
      negative:      profile.negative      ?? '',
      promptAngles:  profile.promptAngles  ?? '',
      promptVariety: profile.promptVariety ?? '',
      ageLabel:      profile.ageLabel      ?? '',
      targetImages:  profile.targetImages  ?? undefined,
      triggerToken:  profile.triggerToken  ?? '',
    });
    setError(null);
    setEditing(true);
  };

  const cancel = () => { setEditing(false); setDraft({}); setError(null); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // Strip empty strings so we don't overwrite with "" — send null intentionally
      // by using empty string if the user explicitly cleared a field. Since
      // backend treats "" as valid, we just send everything.
      const body: UpdateProfileBody = { ...draft };
      // Convert ""→null behaviour: backend will store empty strings, which is OK.
      const updated = await api.updateProfile(profile.id, body);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Описание персонажа</h2>
        {!editing ? (
          <button onClick={startEdit}
            className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1">
            ✎ редактировать
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={save} disabled={busy}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1 rounded">
              {busy ? '…' : 'сохранить'}
            </button>
            <button onClick={cancel} disabled={busy}
              className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1">
              отмена
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="mb-3 text-xs text-red-400 font-mono">{error}</p>
      )}

      <dl className="space-y-3">
        {FIELDS.map((f) => {
          const value = (profile[f.key as keyof ProfileFull] ?? '') as string | number | null;
          const draftValue = draft[f.key];

          return (
            <div key={f.key} className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-1 md:gap-3 items-start">
              <dt className="text-xs uppercase tracking-wider text-zinc-500 pt-1.5">
                {f.label}
                {f.hint && <div className="text-[10px] text-zinc-600 normal-case tracking-normal mt-0.5">{f.hint}</div>}
              </dt>
              <dd>
                {!editing ? (
                  value === null || value === '' ? (
                    <span className="text-zinc-600 text-sm italic">—</span>
                  ) : f.type === 'multiline' ? (
                    <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans break-words">{String(value)}</pre>
                  ) : (
                    <span className="text-sm text-zinc-300 font-mono">{String(value)}</span>
                  )
                ) : f.type === 'multiline' ? (
                  <textarea
                    value={(draftValue as string) ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-sans min-h-[80px] focus:border-blue-600 focus:outline-none"
                    rows={f.key === 'promptAngles' || f.key === 'promptVariety' ? 5 : 3}
                  />
                ) : f.type === 'number' ? (
                  <input
                    type="number"
                    value={(draftValue as number | undefined) ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 font-mono w-32 focus:border-blue-600 focus:outline-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={(draftValue as string) ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 font-mono focus:border-blue-600 focus:outline-none"
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
