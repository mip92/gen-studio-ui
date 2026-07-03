'use client';

import { useShotCtx } from './ShotPageShell';
import { RenderSection } from './ShotDetail';

export function ShotRenderTab() {
  const { shot, setShot } = useShotCtx();
  return (
    <main className="px-4 sm:px-8 py-6">
      <RenderSection shot={shot} onShotChange={setShot} />
    </main>
  );
}
