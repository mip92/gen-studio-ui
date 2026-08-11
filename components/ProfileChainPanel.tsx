'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ChainLinkResult, ProfileChain, ProfileChainState } from '../lib/api';

/**
 * «Состояния персонажа» — the character's profiles as what they actually are:
 * one person in several states of story time, chained for anchor inheritance
 * (`X_YOUNG → X_MID → X_OLD`), not a flat list of unrelated codes.
 *
 * This block exists because the inheritance feature shipped invisible: the only
 * control was a select buried in the footer of the anchor panel, one profile at
 * a time, so all 376 profiles stayed unlinked and every age of one person got a
 * face of its own. Here the whole chain is visible where the character is read,
 * with the link, the donor status and the render gate on every row.
 *
 * Renders nothing for single-state characters — there is no chain to show.
 */
export function ProfileChainPanel({ profileId }: { profileId: string }) {
  const [chain, setChain] = useState<ProfileChain | null>(null);
  const [busy,  setBusy]  = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan,  setPlan]  = useState<ChainLinkResult | null>(null);

  const load = useCallback(async () => {
    try {
      setChain(await api.profileChain(profileId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  useEffect(() => { void load(); }, [load]);

  const run = (tag: string, fn: () => Promise<unknown>) => async () => {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = run('preview', async () => {
    setPlan(await api.linkProfileChain(profileId, { dryRun: true }));
  });

  const handleApply = run('apply', async () => {
    await api.linkProfileChain(profileId, {});
    setPlan(null);
  });

  const handleSetBase = (state: ProfileChainState, baseProfileId: string | null) =>
    run(`base:${state.profileId}`, () => api.setBaseProfile(state.profileId, baseProfileId))();

  if (error && !chain) {
    return (
      <section className="bg-zinc-900 border border-red-900 rounded-lg p-4 mb-6 text-sm text-red-300">
        {error}
      </section>
    );
  }
  if (!chain || chain.states.length < 2) return null;

  const unlinked = chain.states.filter((s, i) => i > 0 && s.baseProfileId === null).length;

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Состояния персонажа</h2>
        <span className={`text-xs px-2 py-0.5 rounded font-mono ${
          chain.chainLinked
            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
            : 'bg-amber-900/30 text-amber-300 border border-amber-900'
        }`}>
          {chain.chainLinked ? 'цепочка связана' : `без наследования: ${unlinked}`}
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Один человек в разные годы. Связанное состояние рендерит якорь как правку якоря предыдущего
        («тот же человек, старше») — лицо не выдумывается заново. Несвязанные состояния дают три разных лица.
      </p>

      <ol className="space-y-1.5">
        {chain.states.map((s, i) => {
          const isCurrent = s.profileId === profileId;
          const derived   = s.baseProfileId !== null;
          return (
            <li
              key={s.profileId}
              className={`rounded border px-3 py-2 ${
                isCurrent ? 'bg-zinc-950 border-purple-800' : 'bg-zinc-950/60 border-zinc-800'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-zinc-600 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                {isCurrent ? (
                  <span className="font-mono text-sm text-purple-200">{s.profileCode}</span>
                ) : (
                  <Link
                    href={`/characters/${s.profileId}/description`}
                    className="font-mono text-sm text-zinc-200 hover:text-purple-300"
                  >
                    {s.profileCode}
                  </Link>
                )}
                <span className="text-xs text-zinc-500">
                  {s.ageLabel ?? '—'}
                  {(s.ageSource === 'code' || s.ageSource === 'unknown') && (
                    <span className="text-amber-400/80" title="возраст не из ageLabel — порядок мог быть угадан"> ≈</span>
                  )}
                </span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                  s.anchorExists
                    ? 'bg-emerald-900/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {s.anchorExists ? 'якорь ✓' : 'нет якоря'}
                </span>
                <span className="text-[11px] text-zinc-500">{s.shotCount} кадр.</span>
                {derived && (
                  <span className="text-[11px] text-zinc-400">← от {s.baseProfileCode}</span>
                )}
                {!s.canRenderAnchor && (
                  <span className="text-[11px] text-amber-300/90" title="рендер якоря заблокирован">
                    ⛔ {s.blockedReason}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-2 pl-7">
                <span className="text-[11px] text-zinc-600">наследует лицо от</span>
                <select
                  className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300 text-[11px]"
                  disabled={busy !== null}
                  value={s.baseProfileId ?? ''}
                  onChange={(e) => void handleSetBase(s, e.target.value === '' ? null : e.target.value)}
                >
                  <option value="">— ни от кого (с нуля) —</option>
                  {chain.states
                    .filter((o) => o.profileId !== s.profileId)
                    .map((o) => (
                      <option key={o.profileId} value={o.profileId}>
                        {o.profileCode}{o.ageLabel ? ` (${o.ageLabel})` : ''}
                        {o.anchorExists ? ' — якорь готов' : ' — якоря нет'}
                      </option>
                    ))}
                </select>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={busy !== null}
          className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded"
        >
          {busy === 'preview' ? 'Считаю…' : 'Показать цепочку по возрасту'}
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={busy !== null || chain.chainLinked}
          title={chain.chainLinked ? 'Цепочка уже связана' : 'Заполнить только пустые связи'}
          className="text-xs bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-3 py-1.5 rounded"
        >
          {busy === 'apply' ? 'Связываю…' : 'Связать по возрасту'}
        </button>
        <span className="text-[11px] text-zinc-600">
          Только связи: ни один готовый якорь не удаляется и не перерисовывается.
        </span>
      </div>

      {plan && (
        <div className="mt-3 bg-zinc-950 border border-zinc-800 rounded p-2 text-[11px]">
          <div className="text-zinc-500 mb-1">
            Порядок по возрасту: <span className="font-mono text-zinc-300">{plan.order.join(' → ')}</span>
          </div>
          {plan.changes.length === 0 ? (
            <div className="text-zinc-500">Менять нечего — связи уже стоят.</div>
          ) : (
            <ul className="text-zinc-300 space-y-0.5">
              {plan.changes.map((c) => (
                <li key={c.profileId} className="font-mono">
                  {c.profileCode}: {c.from} → {c.to}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chain.warnings.length > 0 && (
        <ul className="mt-3 text-[11px] text-amber-300/80 space-y-0.5">
          {chain.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
      {error && <div className="mt-3 text-xs text-red-300">{error}</div>}
    </section>
  );
}
