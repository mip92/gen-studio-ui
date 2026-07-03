'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { useShotCtx } from './ShotPageShell';
import { ParticipantsEditor, ParticipantDraft } from './ShotDetail';

export function ShotParticipantsTab() {
  const { shot, setShot, characters, shotId } = useShotCtx();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<ParticipantDraft[]>([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const startEdit = () => {
    setDraft(shot.participants.map((p) => ({
      label:       p.label,
      characterId: p.characterId,
      profileId:   p.profileId,
    })));
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setDraft([]); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const updated = await api.updateShot(shotId, { participants: draft });
      setShot(updated);
      setEditing(false);
      setDraft([]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="mb-4 flex gap-2 justify-end">
        {!editing ? (
          <button onClick={startEdit}
            className="text-sm bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded">
            ✎ редактировать
          </button>
        ) : (
          <>
            <button onClick={save} disabled={busy}
              className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
              {busy ? '…' : 'сохранить'}
            </button>
            <button onClick={cancel} disabled={busy}
              className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5">
              отмена
            </button>
          </>
        )}
      </div>

      {error && <div className="mb-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>}

      <ParticipantsEditor
        editing={editing}
        participants={editing ? draft : shot.participants.map((p) => ({
          label:       p.label,
          characterId: p.characterId,
          profileId:   p.profileId,
        }))}
        characters={characters}
        shotParticipants={shot.participants}
        onChange={setDraft}
      />

      {!editing && (
        <p className="text-zinc-600 text-xs mt-4">
          Чтобы поменять персонажей или какую LoRA брать (например HERO_TEEN_15 vs HERO_OVERLOAD_16) — нажми «✎ редактировать» вверху.
        </p>
      )}
    </main>
  );
}
