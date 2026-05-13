'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, LoraVariant, ProfileFull } from '../lib/api';

export function LoraListPage({
  projectId, profileId,
}: {
  projectId: string;
  profileId: string;
}) {
  const [profile,  setProfile]  = useState<ProfileFull | null>(null);
  const [variants, setVariants] = useState<LoraVariant[]>([]);
  const [active,   setActive]   = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        api.getProfile(profileId),
        api.listLoraVariants(profileId),
      ]);
      setProfile(p);
      setVariants(l.variants);
      setActive(l.active);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setAsDefault = async (filename: string) => {
    setBusy(`active:${filename}`); setError(null);
    try { await api.setActiveLora(profileId, filename); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (v: LoraVariant) => {
    if (!confirm(`Удалить ${v.label} (${v.filename})?\nФайл будет стёрт с диска.`)) return;
    setBusy(`del:${v.filename}`); setError(null);
    try { await api.deleteLoraVariant(profileId, v.filename); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <main className="px-8 py-6 max-w-5xl mx-auto">
      <Link
        href={`/projects/${projectId}/characters/${profileId}`}
        className="text-zinc-500 hover:text-zinc-200 text-sm mb-4 inline-block"
      >
        ← персонаж
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">LoRA library</h1>
        {profile && (
          <p className="text-zinc-500 text-sm font-mono">
            {profile.character?.code} · {profile.profileCode}
          </p>
        )}
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs mb-4">
          {error}
        </div>
      )}

      {variants.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4">
          Нет LoRA-файлов. Запусти тренировку — kohya сохраняет финальный
          чекпоинт + промежуточные эпохи в <code>models/loras/gen-studio/&lt;slug&gt;/</code>.
        </p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded divide-y divide-zinc-800">
          {variants.map((v) => {
            const isActive = v.fullPath === active;
            return (
              <div key={v.filename} className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Link
                      href={`/projects/${projectId}/characters/${profileId}/loras/${encodeURIComponent(v.filename)}`}
                      className="text-base font-medium hover:underline"
                    >
                      {v.label}
                    </Link>
                    {isActive && (
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-900">
                        по умолчанию
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 font-mono truncate" title={v.filename}>
                    {v.filename}
                  </div>
                  <div className="text-xs text-zinc-600">
                    {Math.round(v.sizeBytes / 1_000_000)} MB · {new Date(v.mtime).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {!isActive && (
                    <button
                      onClick={() => setAsDefault(v.filename)}
                      disabled={busy !== null}
                      className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-900/50 hover:border-emerald-700 px-3 py-1.5 rounded disabled:opacity-40"
                    >
                      {busy === `active:${v.filename}` ? '…' : 'сделать дефолтной'}
                    </button>
                  )}
                  <button
                    onClick={() => remove(v)}
                    disabled={busy !== null}
                    className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-3 py-1.5 rounded disabled:opacity-40"
                  >
                    {busy === `del:${v.filename}` ? '…' : 'удалить'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
