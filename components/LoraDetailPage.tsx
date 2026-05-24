'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, LoraVariant, ProfileFull } from '../lib/api';
import { TrainingHistoryChart } from './TrainingHistoryChart';

/**
 * Detail view for a single LoRA variant. Layout:
 *  - metadata (size, mtime, epoch label, default badge)
 *  - actions (set default, delete)
 *  - training history chart from the run that produced it (loss + step rate)
 *
 * `loraId` is the URL-encoded filename. We resolve it to a variant, then look
 * up the most recent training job for the profile to find its train.log.
 */
export function LoraDetailPage({
  profileId, loraId,
}: {
  profileId: string;
  loraId:    string;
}) {
  const filename = decodeURIComponent(loraId);

  const [profile,  setProfile]   = useState<ProfileFull | null>(null);
  const [variants, setVariants]  = useState<LoraVariant[]>([]);
  const [active,   setActive]    = useState<string | null>(null);
  const [trainingJobId, setJobId] = useState<string | null>(null);
  const [error,    setError]     = useState<string | null>(null);
  const [busy,     setBusy]      = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, l, jobs] = await Promise.all([
        api.getProfile(profileId),
        api.listLoraVariants(profileId),
        api.listTrainingJobs(profileId),
      ]);
      setProfile(p);
      setVariants(l.variants);
      setActive(l.active);
      // Best-effort: most recent job for this profile that produced a log.
      // Variants from the same training run share that run's log; older runs
      // may already be cleaned up — we accept that and fall through to "no log".
      const job = jobs.find((j) => j.logPath) ?? jobs[0] ?? null;
      setJobId(job?.id ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const variant = variants.find((v) => v.filename === filename) ?? null;
  const isActive = variant?.fullPath === active;

  const setAsDefault = async () => {
    if (!variant) return;
    setBusy('active'); setError(null);
    try { await api.setActiveLora(profileId, variant.filename); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    if (!variant) return;
    if (!confirm(`Удалить ${variant.label} (${variant.filename})?\nФайл будет стёрт с диска.`)) return;
    setBusy('del'); setError(null);
    try {
      await api.deleteLoraVariant(profileId, variant.filename);
      // After delete, this variant no longer exists — bounce to list.
      window.location.href = `/characters/${profileId}/loras`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <main className="px-8 py-6">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        {/* Character code / profileCode subtitle is already in the sticky shell
            header (h1) — don't duplicate. Only the variant label remains here. */}
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            {variant?.label ?? filename}
            {isActive && (
              <span className="text-xs uppercase font-mono px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-900">
                по умолчанию
              </span>
            )}
          </h1>
        </div>
        <div className="flex gap-2">
          {variant && !isActive && (
            <button
              onClick={setAsDefault}
              disabled={busy !== null}
              className="text-sm text-emerald-300 hover:text-emerald-200 border border-emerald-900/50 hover:border-emerald-700 px-3 py-1.5 rounded disabled:opacity-40"
            >
              {busy === 'active' ? '…' : 'сделать дефолтной'}
            </button>
          )}
          {variant && (
            <button
              onClick={remove}
              disabled={busy !== null}
              className="text-sm text-red-300 hover:text-red-200 border border-red-900/50 hover:border-red-700 px-3 py-1.5 rounded disabled:opacity-40"
            >
              {busy === 'del' ? '…' : 'удалить'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs mb-4">
          {error}
        </div>
      )}

      {variant ? (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="тип"      value={variant.epoch === null ? 'final' : `epoch ${variant.epoch}`} />
          <Stat label="размер"   value={`${Math.round(variant.sizeBytes / 1_000_000)} MB`} />
          <Stat label="изменён"  value={new Date(variant.mtime).toLocaleString()} />
          <Stat label="файл"     value={variant.filename} mono />
        </section>
      ) : (
        <p className="text-zinc-500 text-sm py-4">
          Файл <code className="font-mono text-zinc-300">{filename}</code> не найден.
          Возможно его удалили или ещё не сохранили — обнови страницу.
        </p>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">История тренировки</h2>
        {trainingJobId ? (
          <TrainingHistoryChart jobId={trainingJobId} />
        ) : (
          <p className="text-zinc-500 text-sm">Нет тренировочного лога для этого профиля.</p>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`text-sm text-zinc-200 mt-1 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}
