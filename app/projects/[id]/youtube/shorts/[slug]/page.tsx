'use client';

import { use } from 'react';
import { PublishStepper } from '@/components/PublishStepper';
import { YoutubeSubnav } from '@/components/YoutubeSubnav';

// One short's publish stepper — its own page (no more modal). Same 5-step flow as
// the main video, but uploads into the «шорты» playlist. Publish in «Связка».
export default function ShortPublishPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = use(params);
  return (
    <main className="px-4 sm:px-8 py-6 max-w-3xl">
      <YoutubeSubnav id={id} />
      <div className="mb-3">
        <a href={`/projects/${id}/youtube/shorts`} className="text-xs text-blue-400 hover:underline">← ко всем шортам</a>
      </div>
      <h1 className="text-xl font-semibold mb-1">Шорт <span className="font-mono text-zinc-500 text-base">{slug}</span></h1>
      <p className="text-xs text-zinc-500 mb-5">Пошагово до заливки Unlisted. Обложка необязательна.</p>
      <PublishStepper id={id} kind="short" slug={slug} />
    </main>
  );
}
