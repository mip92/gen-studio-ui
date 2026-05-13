'use client';

import { useState } from 'react';
import { api } from '../lib/api';

export function CreateSceneModal({
  projectId, existingCount, onClose, onCreated,
}: {
  projectId:     string;
  existingCount: number;
  onClose:       () => void;
  onCreated:     () => void;
}) {
  const nextOrder = existingCount + 1;
  const [sceneKey,  setSceneKey]  = useState(`scene_${String(nextOrder).padStart(2, '0')}_`);
  const [title,     setTitle]     = useState('');
  const [sortOrder, setSortOrder] = useState<number>(nextOrder);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.createScene(projectId, {
        sceneKey:   sceneKey.trim(),
        title:      title.trim() || undefined,
        sortOrder,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6 space-y-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Новая сцена</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        <Field label="Scene key" hint="Технический ключ, lower_snake_case (напр. scene_06_finale)">
          <input
            type="text" value={sceneKey} onChange={(e) => setSceneKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            required pattern="[a-z][a-z0-9_]*" minLength={3}
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <Field label="Title" hint="Человеко-читаемое название сцены">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="напр. Финал: героя выписывают из больницы"
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <Field label="Sort order" hint="Порядковый номер в сценарии">
          <input
            type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))}
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-32 focus:border-blue-600 focus:outline-none"
          />
        </Field>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>
        )}

        <footer className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-4 py-2">
            отмена
          </button>
          <button type="submit" disabled={busy || !sceneKey.trim()}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded">
            {busy ? '…' : 'создать'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label, hint, children,
}: {
  label:    string;
  hint?:    string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
        {label}
        {hint && <span className="text-zinc-600 normal-case tracking-normal ml-2">— {hint}</span>}
      </div>
      {children}
    </label>
  );
}
