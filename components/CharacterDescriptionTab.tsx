'use client';

import Link from 'next/link';
import { useCharacterCtx } from './CharacterPageShell';
import { Stat, ProfileDescription } from './CharacterDetail';
import { ProfileChainPanel } from './ProfileChainPanel';

export function CharacterDescriptionTab() {
  const { profileId, profile, profileFull, setProfileFull, refresh } = useCharacterCtx();

  return (
    <main className="px-4 sm:px-8 py-6">
      {/* Stats grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="датасет" value={`${profile.datasetCount} img`} />
        <Stat label="возраст" value={profile.ageLabel ?? '—'} />
        <Stat label="триггер" value={profile.triggerToken ?? '—'} mono />
        <Link
          href={`/characters/${profileId}/loras`}
          className={`text-left rounded-lg border p-3 transition block
            ${profile.loraReady
              ? 'bg-emerald-900/20 border-emerald-800 hover:border-emerald-600'
              : 'bg-zinc-900    border-zinc-800   hover:border-zinc-600'}`}
          title="Открыть библиотеку LoRA"
        >
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">LoRA</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-mono text-sm ${profile.loraReady ? 'text-emerald-200' : 'text-zinc-300'}`}>
              {profile.loraReady ? `${profile.loraSizeMB} MB` : '—'}
            </span>
            <span className="text-[10px] text-zinc-500">
              {(profileFull?.loraVariants?.length ?? 0) > 0
                ? `${profileFull!.loraVariants!.length} вар. →`
                : 'управление →'}
            </span>
          </div>
        </Link>
      </section>

      {/* The character's states + anchor inheritance. Self-hides when there is
          only one profile. */}
      <ProfileChainPanel profileId={profileId} />

      {profileFull && (
        <ProfileDescription
          profile={profileFull}
          onSaved={(updated) => { setProfileFull(updated); void refresh(); }}
        />
      )}
    </main>
  );
}
