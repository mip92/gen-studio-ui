'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function DeleteCharacterModal({
  projectId, characterId, onClose, onDeleted,
}: {
  projectId:   string;
  characterId: string;
  onClose:     () => void;
  onDeleted:   () => void;
}) {
  type Usage = Awaited<ReturnType<typeof api.characterUsage>>;
  const [usage,   setUsage]   = useState<Usage | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    api.characterUsage(projectId, characterId).then(setUsage).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId, characterId]);

  const handleDelete = async () => {
    setBusy(true); setError(null);
    try {
      await api.deleteCharacter(projectId, characterId);
      onDeleted();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const expectedConfirm = usage?.character.code ?? '';
  const canDelete       = usage && confirm === expectedConfirm;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-red-900/50 rounded-lg max-w-lg w-full p-6 space-y-4 max-h-[85dvh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-red-400">Удалить персонажа</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        {!usage ? (
          <p className="text-zinc-500 text-sm">Загрузка…</p>
        ) : (
          <>
            <div className="text-sm text-zinc-300">
              Удалить <code className="font-mono bg-zinc-800 px-2 py-0.5 rounded">{usage.character.code}</code> ({usage.character.displayName ?? '—'})?
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded p-4 space-y-2 text-xs">
              <UsageRow label="Профили (LoRA, датасеты)" value={usage.profileCount} />
              <UsageRow label="Кадры с этим персонажем" value={usage.shotCount} />
              <UsageRow label="Акты затронуты"            value={usage.sceneCount} />
              <UsageRow label="Записи участия в кадрах"   value={usage.participantCount} />
            </div>

            {usage.shotCount > 0 ? (
              <div className="bg-amber-900/30 border border-amber-700/50 rounded p-3 text-xs text-amber-200 space-y-1">
                <p className="font-medium">Внимание:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Из <strong>{usage.shotCount}</strong> кадров уберутся записи об этом персонаже (сами кадры не удалятся)</li>
                  <li>Все профили и их датасеты в БД</li>
                  <li>Все папки <code>data/&lt;slug&gt;/datasets/&lt;profileCode&gt;/</code></li>
                  <li>Все папки <code>data/&lt;slug&gt;/reference/&lt;profileCode&gt;/</code></li>
                  <li>LoRA-файлы из <code>models/loras/gen-studio/&lt;slug&gt;/&lt;profileCode&gt;*</code></li>
                  <li>Сгенерированные изображения в <code>ComfyUI/output/&lt;profileCode&gt;*</code></li>
                </ul>
              </div>
            ) : (
              <div className="bg-emerald-900/30 border border-emerald-700/50 rounded p-3 text-xs text-emerald-200">
                Этот персонаж не используется ни в одном кадре. Удалится только сам персонаж + его профили + связанные файлы.
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                Для подтверждения введи код персонажа: <code className="font-mono text-red-400">{expectedConfirm}</code>
              </div>
              <input
                type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus
                placeholder={expectedConfirm}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-zinc-200 focus:border-red-600 focus:outline-none"
              />
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>
            )}

            <footer className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} disabled={busy}
                className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-4 py-2">
                отмена
              </button>
              <button
                onClick={handleDelete}
                disabled={busy || !canDelete}
                className="bg-red-700 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
              >
                {busy ? 'удаляю…' : 'удалить навсегда'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function UsageRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono ${value > 0 ? 'text-zinc-200' : 'text-zinc-600'}`}>{value}</span>
    </div>
  );
}
