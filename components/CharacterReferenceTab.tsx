'use client';

import { useCharacterCtx } from './CharacterPageShell';
import { ReferenceUploader } from './CharacterDetail';
import { CharacterAnchorPanel } from './CharacterAnchorPanel';

/**
 * Reference tab — shows the identity-asset uploader appropriate for the
 * character's pipeline:
 *
 *  - photoreal pipeline ('lora')  → ReferenceUploader (single portrait that
 *    feeds the ai_syndicate_dataset_creator to generate 30 photos for LoRA training)
 *  - cartoon pipeline ('anchor')  → CharacterAnchorPanel (single PNG that
 *    IP-Adapter loads at shot-render time for face-lock; no training)
 *  - mixed ('mixed', both projects attached) → both panels
 *  - library mode ('none', no project attached yet) → both panels (let user
 *    populate either, then attach to whichever project later)
 *
 * This kills the duplicate-uploader confusion on cartoon character pages and
 * the "no LoRA" warnings that don't apply to anchor-based identity.
 */
export function CharacterReferenceTab() {
  const { profileId, identityPipeline } = useCharacterCtx();

  const showLoraPath   = identityPipeline === 'lora'   || identityPipeline === 'mixed' || identityPipeline === 'none';
  const showAnchorPath = identityPipeline === 'anchor' || identityPipeline === 'mixed' || identityPipeline === 'none';

  return (
    <main className="px-8 py-6 space-y-4">
      {showLoraPath   && <ReferenceUploader profileId={profileId} />}
      {showAnchorPath && <CharacterAnchorPanel profileId={profileId} />}
    </main>
  );
}
