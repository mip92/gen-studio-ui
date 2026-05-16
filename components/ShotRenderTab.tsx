'use client';

import { useShotCtx } from './ShotPageShell';
import { RenderSection } from './ShotDetail';

export function ShotRenderTab() {
  const { shot, setShot } = useShotCtx();
  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <RenderSection shot={shot} onShotChange={setShot} />
    </main>
  );
}
