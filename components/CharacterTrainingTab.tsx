'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { useCharacterCtx } from './CharacterPageShell';
import { TrainingProgress } from './CharacterDetail';

export function CharacterTrainingTab() {
  const { profile, profileId, refresh } = useCharacterCtx();
  const [busy, setBusy] = useState<string | null>(null);

  const dsActive = !!profile.lastDatasetJob && ['pending','blocked','running'].includes(profile.lastDatasetJob.status);
  const trActive = !!profile.lastTrainingJob && !['completed','failed','cancelled'].includes(profile.lastTrainingJob.status);

  const handleTrain = async () => {
    if (!confirm(`Запустить тренировку LoRA для ${profile.profileCode}?\n\nДатасет: ${profile.datasetCount} картинок.`)) return;
    setBusy('train');
    try {
      await api.startTraining(profileId, { numRepeats: 10, maxSteps: 1500, networkDim: 32 });
      await refresh();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const trLabel = !trActive ? '⚙ обучить LoRA'
                 : `⚙ обучается… (${profile.lastTrainingJob!.status})`;

  return (
    <main className="px-4 sm:px-8 py-6 space-y-6">
      <TrainingProgress trainingJob={profile.lastTrainingJob} />

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-4">Запустить тренировку</h2>

        <div className="space-y-3 text-sm text-zinc-400 mb-4">
          <div>Датасет: <span className="text-zinc-200 font-mono">{profile.datasetCount}</span> картинок</div>
          <div>Параметры по умолчанию: <code className="text-zinc-300">numRepeats=10, maxSteps=1500, networkDim=32</code></div>
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <button
            onClick={handleTrain}
            disabled={busy !== null || profile.datasetCount === 0 || dsActive || trActive}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
            title={
              profile.datasetCount === 0 ? 'Нет датасета — сначала сгенерируй на вкладке «Датасет»' :
              dsActive ? 'Идёт генерация датасета — дождись завершения' :
              trActive ? 'Уже тренируется' : ''
            }
          >
            {busy === 'train' ? '…' : trLabel}
          </button>

          <Link
            href={`/characters/${profileId}/loras`}
            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-900/50 hover:border-blue-700 rounded px-3 py-2"
          >
            📚 Все варианты LoRA →
          </Link>

          {trActive && (
            <span className="text-xs text-zinc-500">обновляется каждые 5 сек</span>
          )}
        </div>
      </section>
    </main>
  );
}
