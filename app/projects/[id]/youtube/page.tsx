'use client';

import { use } from 'react';
import { PublishStepper } from '@/components/PublishStepper';
import { YoutubeSubnav } from '@/components/YoutubeSubnav';

// «Видео» — the main video's publish stepper (params → CapCut → file → subtitles
// → Unlisted upload). The final publish (link + schedule) lives in «Связка-запуск».
export default function YoutubePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <main className="px-4 sm:px-8 py-6 max-w-3xl">
      <YoutubeSubnav id={id} />
      <h1 className="text-xl font-semibold mb-1">Основное видео</h1>
      <p className="text-xs text-zinc-500 mb-5">Пошагово до заливки Unlisted. Публикация всего вместе — на вкладке «🔗 Связка-запуск».</p>
      <PublishStepper id={id} kind="main" />
    </main>
  );
}
