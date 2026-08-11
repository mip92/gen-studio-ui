'use client';

import { useState } from 'react';
import { api } from '../lib/api';

export function CreateShotModal({
  projectId, sceneId, existingShotCount, onClose, onCreated,
}: {
  projectId:         string;
  sceneId:           string;
  existingShotCount: number;
  onClose:           () => void;
  onCreated:         () => void;
}) {
  const nextNum = existingShotCount + 1;
  const [shotCode,      setShotCode]      = useState(`SH${String(nextNum).padStart(2, '0')}`);
  const [narrativeBeat, setNarrativeBeat] = useState('');
  const [location,      setLocation]      = useState('');
  const [busy,          setBusy]          = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.createShot(projectId, {
        shotCode: shotCode.trim(),
        sceneId,
        promptFields: {
          narrativeBeat: narrativeBeat.trim() || undefined,
          location:      location.trim() ? { label: location.trim() } : undefined,
        },
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        // max-h + overflow-y: on a phone this form is taller than the screen,
        // and a centred fixed panel with no scroller of its own puts the submit
        // button past the bottom edge with no way to reach it.
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6 space-y-4 max-h-[85dvh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Новый кадр</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        <Field label="Shot code" hint="Уникальный код кадра, напр. S01_SH23">
          <input
            type="text" value={shotCode} onChange={(e) => setShotCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            required pattern="[A-Z][A-Z0-9_]*"
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <Field label="Beat (что происходит)">
          <textarea
            value={narrativeBeat} onChange={(e) => setNarrativeBeat(e.target.value)}
            rows={3}
            placeholder="Герой стоит у окна, смотрит на дождь"
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <Field label="Локация">
          <input
            type="text" value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="напр. Квартира кухня"
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full focus:border-blue-600 focus:outline-none"
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
          <button type="submit" disabled={busy || !shotCode.trim()}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded">
            {busy ? '…' : 'создать'}
          </button>
        </footer>
        <p className="text-xs text-zinc-600 pt-1">
          Подробное редактирование (промпты, persona, освещение, камера) — на странице кадра после создания.
        </p>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
