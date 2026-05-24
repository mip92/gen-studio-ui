'use client';

import { useCharacterCtx } from './CharacterPageShell';
import { ReferenceUploader } from './CharacterDetail';

export function CharacterReferenceTab() {
  const { profileId } = useCharacterCtx();
  return (
    <main className="px-8 py-6">
      <ReferenceUploader profileId={profileId} />
    </main>
  );
}
