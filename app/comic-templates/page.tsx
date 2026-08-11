'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';

/**
 * Галерея комикс-шаблонов страниц — витрина реестра
 * gen-studio/scripts/comic_page_templates.json (источник истины; UI зеркала
 * не держит, всё через API). Карточка = превью-разворот (шаблон на обеих
 * страницах, цветные панели пронумерованы В ПОРЯДКЕ ПОЛЁТА КАМЕРЫ) + состав
 * панелей. `id` шаблона — это то, на что ссылается план проекта
 * (comic_pages.templateId); правки самих раскладок делаются в JSON-реестре и
 * проходят через валидатор comic_page_registry.py.
 */

type Tpl = Awaited<ReturnType<typeof api.comicPageTemplates>>[number];

const SHAPE_BADGE: Record<string, { label: string; cls: string }> = {
  wide:      { label: 'wide 2.35:1',  cls: 'text-orange-300 bg-orange-900/40' },
  landscape: { label: '16:9',         cls: 'text-sky-300 bg-sky-900/40' },
  square:    { label: '1:1',          cls: 'text-emerald-300 bg-emerald-900/40' },
  tall:      { label: 'tall 2:3',     cls: 'text-fuchsia-300 bg-fuchsia-900/40' },
  narrow:    { label: 'narrow 9:16',  cls: 'text-teal-300 bg-teal-900/40' },
  tall_page: { label: 'вся страница', cls: 'text-red-300 bg-red-900/40' },
};

export default function ComicTemplatesPage() {
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.comicPageTemplates()
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    // min-h-full, not min-h-screen: 100vh is taller than the page column
    // (large viewport vs dvh minus the mobile top bar), which gave the page a
    // permanent phantom scroll tail on mobile even when the grid was short.
    <main className="min-h-full">
      <PageHeader
        crumbs={[{ label: 'Обзор', href: '/' }, { label: 'Комикс-шаблоны' }]}
        title="Комикс-шаблоны страниц"
        subtitle={
          templates
            ? `${templates.length} шаблонов • реестр scripts/comic_page_templates.json • id шаблона = comic_pages.templateId в плане проекта`
            : 'Загрузка…'
        }
      />
      <div className="px-4 sm:px-8 py-6">
        {error && <p className="text-red-400 text-sm mb-4">Ошибка: {error}</p>}
        {templates && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {templates.map((t) => {
              const counts = t.slots.reduce<Record<string, number>>((acc, s) => {
                acc[s.shape] = (acc[s.shape] ?? 0) + 1;
                return acc;
              }, {});
              return (
                <div key={t.id} className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
                  {/* превью — разворот с этим шаблоном на обеих страницах; цифры = маршрут камеры */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.comicTemplatePreviewUrl(t.id)}
                    alt={t.id}
                    className="w-full aspect-video object-cover bg-zinc-900"
                    loading="lazy"
                  />
                  <div className="p-3 space-y-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-sm text-zinc-200">{t.id}</span>
                      <span className="text-xs text-zinc-500">{t.slots.length} панелей</span>
                    </div>
                    <div className="text-sm text-zinc-400">{t.name}</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(counts).map(([shape, n]) => {
                        const b = SHAPE_BADGE[shape] ?? { label: shape, cls: 'text-zinc-300 bg-zinc-800' };
                        return (
                          <span key={shape} className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${b.cls}`}>
                            {n}× {b.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
