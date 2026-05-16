'use client';

import { useCharacterCtx } from './CharacterPageShell';
import { ReferenceUploader } from './CharacterDetail';

export function CharacterReferenceTab() {
  const { profileId } = useCharacterCtx();
  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <ReferenceUploader profileId={profileId} />
    </main>
  );
}
