'use client';

import { useState } from 'react';
import { api } from '../lib/api';

export function CreateCharacterModal({
  projectId, onClose, onCreated,
}: {
  projectId: string;
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [code,         setCode]         = useState('');
  const [displayName,  setDisplayName]  = useState('');
  const [profileCode,  setProfileCode]  = useState('');
  const [promptBase,   setPromptBase]   = useState('');
  const [ageLabel,     setAgeLabel]     = useState('');
  const [targetImages, setTargetImages] = useState<number>(60);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // Derive default profileCode from code (e.g. HERO → HERO_BASE) on first edit
  const handleCodeChange = (v: string) => {
    const upper = v.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    setCode(upper);
    if (!profileCode || profileCode === code + '_BASE') {
      setProfileCode(upper ? `${upper}_BASE` : '');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.createCharacter(projectId, {
        code:        code.trim(),
        displayName: displayName.trim() || undefined,
        profile: profileCode.trim() && promptBase.trim() ? {
          profileCode:  profileCode.trim(),
          promptBase:   promptBase.trim(),
          ageLabel:     ageLabel.trim() || undefined,
          targetImages: targetImages,
        } : undefined,
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
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-xl w-full p-6 space-y-4 max-h-[85dvh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Новый персонаж</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        <Field label="Code" hint="Уникальный код, UPPER_SNAKE_CASE (например HERO, MOTHER, DOCTOR)">
          <input
            type="text" value={code} onChange={(e) => handleCodeChange(e.target.value)}
            required pattern="[A-Z][A-Z0-9_]*" minLength={2}
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <Field label="Display name" hint="Человеко-читаемое имя">
          <input
            type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="напр. Главный герой"
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full focus:border-blue-600 focus:outline-none"
          />
        </Field>

        <div className="border-t border-zinc-800 pt-4 space-y-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Первый профиль (опционально)</p>

          <Field label="Profile code" hint="Например HERO_TEEN_15. Можно пропустить и добавить позже.">
            <input
              type="text" value={profileCode} onChange={(e) => setProfileCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-full focus:border-blue-600 focus:outline-none"
            />
          </Field>

          <Field label="Prompt base" hint="Описание персонажа для генерации датасета">
            <textarea
              value={promptBase} onChange={(e) => setPromptBase(e.target.value)}
              rows={3}
              placeholder="portrait photo of HERO, male teen 15 years old, eastern european features..."
              className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm w-full focus:border-blue-600 focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Возраст">
              <input
                type="text" value={ageLabel} onChange={(e) => setAgeLabel(e.target.value)}
                placeholder="напр. 15 или 30-55"
                className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full focus:border-blue-600 focus:outline-none"
              />
            </Field>

            <Field label="Target images">
              <input
                type="number" min={1} value={targetImages} onChange={(e) => setTargetImages(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono w-full focus:border-blue-600 focus:outline-none"
              />
            </Field>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>
        )}

        <footer className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-4 py-2">
            отмена
          </button>
          <button type="submit" disabled={busy || !code.trim()}
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
