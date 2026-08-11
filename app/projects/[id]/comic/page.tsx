'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/**
 * «Вёрстка» — постраничный план комикса проекта. С ЭТОЙ вкладки начинается
 * комикс-проект: сначала выбирается последовательность шаблонов страниц
 * (план вёрстки), и только потом пишется сценарий под формы панелей.
 *
 * Два режима:
 *  - шаблонный (есть строки comic_pages): карточка = страница, панели
 *    отрисованы по rect шаблона; в занятых слотах — рендер кадра;
 *    страницы добавляются/удаляются здесь;
 *  - стандартное видео (плана нет): каждая страница — просто один кадр
 *    1920×1080 (read-only), сверху — кнопка «начать комикс-план».
 */

type Plan = Awaited<ReturnType<typeof api.comicPlan>>;
type Tpl = Awaited<ReturnType<typeof api.comicPageTemplates>>[number];

// пустой слот подкрашивается лёгкой плашкой цвета формы ПОВЕРХ бумаги —
// как цветные плейсхолдеры в галерее /comic-templates
const SHAPE_TINT: Record<string, string> = {
  wide: 'bg-orange-700/25 text-orange-950',
  landscape: 'bg-sky-700/25 text-sky-950',
  square: 'bg-emerald-700/25 text-emerald-950',
  tall: 'bg-fuchsia-700/25 text-fuchsia-950',
  narrow: 'bg-teal-700/25 text-teal-950',
  tall_page: 'bg-red-700/25 text-red-950',
};

// пиксельный аспект СТРАНИЦЫ (портретная половина листа 16:9) — из геометрии
// comic_page_registry: (0.4325*1920)/(0.83*1080) ≈ 0.9264
const PAGE_ASPECT = '830 / 896';
// «бумага» и «чернила» — те же тона, что в OldComicPageStyle (PAPER/INK),
// чтобы карточка выглядела как страницы в галерее шаблонов
const PAPER = '#eee2c4';
const PAPER_CARD = 'relative rounded-[3px] shadow-lg shadow-black/50 ring-1 ring-black/60';
const PANEL_FRAME = 'absolute overflow-hidden border-[3px] border-[#18140f]';

const LEGACY_PAGE_SIZE = 24;

export default function ComicLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addTemplate, setAddTemplate] = useState('');
  const [legacyShown, setLegacyShown] = useState(LEGACY_PAGE_SIZE);

  const reload = () =>
    api.comicPlan(id).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    reload();
    api.comicPageTemplates().then((t) => {
      setTemplates(t);
      setAddTemplate((prev) => prev || t[0]?.id || '');
    }).catch(() => setTemplates(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addPage = async () => {
    if (!addTemplate) return;
    setBusy(true); setError(null);
    try {
      await api.comicAddPage(id, addTemplate);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deletePage = async (pageId: string, pageIndex: number, assigned: number) => {
    const warn = assigned > 0
      ? `Страница ${pageIndex}: с неё будут сняты ${assigned} кадр(ов). Удалить?`
      : `Удалить страницу ${pageIndex}?`;
    if (!window.confirm(warn)) return;
    setBusy(true); setError(null);
    try {
      await api.comicDeletePage(id, pageId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!plan) {
    return <main className="px-4 sm:px-8 py-6"><p className="text-zinc-500">{error ?? 'Загрузка…'}</p></main>;
  }

  const addControls = (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={addTemplate}
        onChange={(e) => setAddTemplate(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
        {(templates ?? []).map((t) => (
          <option key={t.id} value={t.id}>{t.id} — {t.name} ({t.slots.length} пан.)</option>
        ))}
      </select>
      <button
        onClick={addPage}
        disabled={busy || !addTemplate}
        className="bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-sm px-3 py-1.5 rounded">
        + Страница
      </button>
      <Link href="/comic-templates" className="text-sky-400 hover:underline text-xs">
        галерея шаблонов →
      </Link>
    </div>
  );

  return (
    <main className="px-4 sm:px-8 py-6 space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!plan.templateMode && (
        <>
          <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-950">
            <div className="text-sm text-zinc-300">
              План вёрстки не задан — показана <b>стандартная сетка комикса</b>, как её соберёт экспорт:
              разворот = 12 кадров, по 6 на страницу ({plan.pages.length} страниц,{' '}
              {plan.pages.length ? plan.pages[plan.pages.length - 1].spreadIndex + 1 : 0} разворотов).
            </div>
            <div className="text-xs text-zinc-500">
              Шаблонная вёрстка начинается здесь: добавьте первую страницу с шаблоном — проект перейдёт в
              шаблонный режим (число страниц чётное, кадры назначаются в слоты при засеивании).
            </div>
            {addControls}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {plan.pages.slice(0, legacyShown).map((p) => (
              <div key={p.pageIndex} className="space-y-1.5">
                <div className={PAPER_CARD} style={{ aspectRatio: PAGE_ASPECT, backgroundColor: PAPER }}>
                  {p.slots.map((s) => (
                    <div key={s.slot}
                         className={PANEL_FRAME}
                         style={{
                           left: `${s.rect.x * 100}%`, top: `${s.rect.y * 100}%`,
                           width: `${s.rect.w * 100}%`, height: `${s.rect.h * 100}%`,
                         }}>
                      {s.shot.chosenRender ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={api.shotImageUrl(s.shot.id, s.shot.chosenRender)} alt={s.shot.shotCode}
                             className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${SHAPE_TINT[s.shape] ?? ''}`}>
                          <span className="text-sm font-bold opacity-70">{s.order + 1}</span>
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 bg-black/60 text-white font-mono text-[9px] px-1">
                        {s.shot.shotCode}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-1 text-xs text-zinc-400">
                  Разворот {p.spreadIndex + 1}
                  <span className="text-zinc-600"> · </span>
                  {p.side === 'left' ? 'левая' : p.side === 'right' ? 'правая' : 'одиночная (хвост)'}
                  <span className="text-zinc-600"> · </span>
                  <span className="text-zinc-500 font-mono">{p.templateId}</span>
                </div>
              </div>
            ))}
          </div>
          {plan.pages.length > legacyShown && (
            <button onClick={() => setLegacyShown((v) => v + LEGACY_PAGE_SIZE * 2)}
                    className="text-sm text-sky-400 hover:underline">
              показать ещё ({plan.pages.length - legacyShown} стр.)
            </button>
          )}
        </>
      )}

      {plan.templateMode && (
        <>
          <div className="border border-zinc-800 rounded-lg p-4 space-y-2 bg-zinc-950">
            <div className="text-sm text-zinc-300">
              Шаблонный план: <b>{plan.pages.length} страниц</b> ({Math.ceil(plan.pages.length / 2)} разворотов).
              {plan.pages.length % 2 === 1 && (
                <span className="text-amber-300"> Число страниц нечётное — экспорт будет заблокирован, добавьте ещё одну.</span>
              )}
            </div>
            {addControls}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {plan.pages.map((p) => {
              const assigned = p.slots.filter((s) => s.shot).length;
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className={PAPER_CARD} style={{ aspectRatio: PAGE_ASPECT, backgroundColor: PAPER }}>
                    {p.slots.map((s) => (
                      <div key={s.slot}
                           className={PANEL_FRAME}
                           style={{
                             left: `${s.rect.x * 100}%`, top: `${s.rect.y * 100}%`,
                             width: `${s.rect.w * 100}%`, height: `${s.rect.h * 100}%`,
                           }}>
                        {s.shot?.chosenRender ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={api.shotImageUrl(s.shot.id, s.shot.chosenRender)} alt={s.shot.shotCode}
                               className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className={`w-full h-full flex flex-col items-center justify-center gap-0.5 ${SHAPE_TINT[s.shape] ?? ''}`}>
                            <span className="text-lg font-bold opacity-70">{s.order + 1}</span>
                            <span className="text-[9px] uppercase tracking-wider opacity-60">{s.shape}</span>
                          </div>
                        )}
                        {s.shot && (
                          <span className="absolute bottom-0 right-0 bg-black/60 text-white font-mono text-[9px] px-1">
                            {s.shot.shotCode}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="px-1 flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs text-zinc-400">
                      Стр. {p.pageIndex + 1} <span className="text-zinc-600">·</span>{' '}
                      <span className="font-mono text-zinc-500">{p.templateId}</span>{' '}
                      <span className="text-zinc-600">·</span>{' '}
                      <span className="text-zinc-500">{assigned}/{p.slots.length} занято</span>
                    </div>
                    <button
                      onClick={() => deletePage(p.id, p.pageIndex + 1, assigned)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50 text-xs shrink-0">
                      удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
