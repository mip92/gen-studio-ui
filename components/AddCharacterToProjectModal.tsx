'use client';

import { useEffect, useState } from 'react';
import { api, LibraryCharacter } from '../lib/api';

/**
 * Attach-a-character modal for the project cast page. Nothing is loaded until
 * the user types — the library is searched server-side (?q=) and only the top
 * matches come back, so the huge full-library grid never renders here.
 * Selecting a match shows its photo (anchor PNG first, dataset image as
 * fallback) before the «назначить» button commits the attach.
 */
export function AddCharacterToProjectModal({
  projectSlug, attachedIds, onClose, onAttached,
}: {
  projectSlug: string;
  /** Characters already in the project — shown as «уже в проекте», not re-attachable. */
  attachedIds: Set<string>;
  onClose:     () => void;
  /** Called after every successful attach so the page behind can refresh. */
  onAttached:  () => void;
}) {
  const [q,        setQ]        = useState('');
  const [rows,     setRows]     = useState<LibraryCharacter[] | null>(null);
  const [total,    setTotal]    = useState(0);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LibraryCharacter | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  // Attaches done from this modal session — merged with the prop so freshly
  // added rows flip to «уже в проекте» without waiting for the parent refresh.
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const isAttached = (id: string) => attachedIds.has(id) || justAdded.has(id);

  // Debounced server-side search. Empty query → empty state, no full-list load.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setRows(null); setTotal(0); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const page = await api.listLibraryCharactersPage(0, 10, query);
        setRows(page.rows);
        setTotal(page.total);
        setError(null);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const attach = async (c: LibraryCharacter) => {
    setBusy(true); setError(null);
    try {
      await api.attachCharacter(projectSlug, c.id);
      setJustAdded((s) => new Set(s).add(c.id));
      onAttached();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-2xl w-full p-6 space-y-4 max-h-[90dvh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Добавить персонажа в проект</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSelected(null); }}
          autoFocus
          placeholder="Поиск по имени или коду (например Вера, HERO)…"
          className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm w-full focus:border-blue-600 focus:outline-none"
        />

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>
        )}

        {/* Results */}
        {!q.trim() ? (
          <p className="text-zinc-600 text-sm py-6 text-center">
            Начни вводить имя — библиотека ищется на сервере, целиком не грузится.
          </p>
        ) : searching && !rows ? (
          <p className="text-zinc-500 text-sm py-6 text-center">Ищем…</p>
        ) : rows && rows.length === 0 ? (
          <p className="text-zinc-500 text-sm py-6 text-center">Ничего не найдено по «{q.trim()}»</p>
        ) : rows ? (
          <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800/60 transition
                    ${selected?.id === c.id ? 'bg-zinc-800' : ''}`}
                >
                  <ResultThumb profileId={c.profiles[0]?.id ?? null} size={44} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{c.displayName ?? c.code}</span>
                    <span className="block text-xs text-zinc-500 font-mono truncate">
                      {c.code}
                      {c.profiles.length > 0 && ` · ${c.profiles.map((p) => p.profileCode).join(', ')}`}
                    </span>
                  </span>
                  {isAttached(c.id) ? (
                    <span className="text-xs px-2 py-1 rounded bg-blue-900/60 text-blue-200 shrink-0">уже в проекте</span>
                  ) : c.projectLinks.length > 0 ? (
                    <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 shrink-0">
                      {c.projectLinks.length} пр.
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {total > rows.length && (
              <li className="px-3 py-2 text-xs text-zinc-600">
                показаны первые {rows.length} из {total} — уточни запрос
              </li>
            )}
          </ul>
        ) : null}

        {/* Preview of the selected character before attaching */}
        {selected && (
          <div className="border border-zinc-700 rounded-lg p-4 flex gap-4 items-start bg-zinc-950/60">
            <ResultThumb profileId={selected.profiles[0]?.id ?? null} size={160} rounded="rounded-lg" />
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="font-semibold text-lg">{selected.displayName ?? selected.code}</div>
                <div className="text-xs text-zinc-500 font-mono">{selected.code}</div>
              </div>
              {selected.profiles.length > 0 && (
                <div className="text-xs text-zinc-400">
                  Профили: <span className="font-mono">{selected.profiles.map((p) => p.profileCode).join(', ')}</span>
                </div>
              )}
              {selected.projectLinks.length > 0 && (
                <div className="text-xs text-zinc-500">
                  В проектах: {selected.projectLinks.map((l) => l.project.slug).join(', ')}
                </div>
              )}
              <div className="pt-1">
                {isAttached(selected.id) ? (
                  <span className="text-sm text-blue-300">✓ уже в проекте</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => attach(selected)}
                    className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded"
                  >
                    {busy ? '…' : 'Назначить на проект'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <footer className="flex justify-end pt-1">
          <button
            type="button" onClick={onClose}
            className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-4 py-2"
          >
            закрыть
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Photo preview for a profile: anchor PNG first (cartoon/library personas),
 * first usable dataset image as fallback (photoreal personas).
 */
function ResultThumb({
  profileId, size, rounded = 'rounded',
}: {
  profileId: string | null;
  size:      number;
  rounded?:  string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null); setFailed(false);
    if (!profileId) return;
    let alive = true;
    (async () => {
      try {
        const a = await api.getAnchor(profileId);
        if (!alive) return;
        if (a.exists) { setUrl(api.anchorRawUrl(profileId)); return; }
        const r = await api.listImages(profileId);
        if (!alive) return;
        const usable = r.images.find((i) => i.size > 50_000) ?? r.images[0];
        setUrl(usable ? api.imageUrl(profileId, usable.filename) : null);
      } catch { /* leave placeholder */ }
    })();
    return () => { alive = false; };
  }, [profileId]);

  if (!url || failed) {
    return (
      <div
        className={`bg-zinc-800 text-zinc-600 flex items-center justify-center shrink-0 ${rounded}`}
        style={{ width: size, height: size, fontSize: Math.max(10, size / 8) }}
      >
        нет фото
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className={`object-cover shrink-0 ${rounded}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
