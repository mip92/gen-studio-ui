'use client';

import { useEffect, useState, use } from 'react';
import { api, ProjectFull } from '@/lib/api';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

/** CapCut export type out of project.settings (see PublishStepper). */
type ExportType = 'linear' | 'comic' | 'comic_chunks';
function exportTypeOf(settings: unknown): ExportType {
  const s = (settings as { exportType?: unknown } | null | undefined)?.exportType;
  return s === 'comic' || s === 'comic_chunks' ? s : 'linear';
}

type TransitionPreset = 'default' | 'comic';
function transitionPresetOf(settings: unknown): TransitionPreset {
  const s = (settings as { transitionPreset?: unknown } | null | undefined)?.transitionPreset;
  return s === 'comic' ? 'comic' : 'default';
}

/** Desk-prop registries — MIRROR gen-studio/scripts/comic_desk_props.py
 *  (SLOTS / ITEMS): same canvas anchors, same sprite heights (fractions of
 *  canvas HEIGHT), so the mock below shows the props at the exporter's true
 *  positions and scale. The python side validates against its registries, so
 *  an unknown key is silently dropped there — keep the lists in sync. */
const DESK_SLOTS = [
  { key: 'top_left',     label: 'верх · слева',  cx: 0.033, cy: 0.026 },
  { key: 'top_center',   label: 'верх · центр',  cx: 0.500, cy: 0.018 },
  { key: 'top_right',    label: 'верх · справа', cx: 0.965, cy: 0.026 },
  { key: 'left',         label: 'слева',         cx: 0.020, cy: 0.400 },
  { key: 'right',        label: 'справа',        cx: 0.980, cy: 0.430 },
  { key: 'bottom_left',  label: 'низ · слева',   cx: 0.034, cy: 0.956 },
  { key: 'bottom_right', label: 'низ · справа',  cx: 0.964, cy: 0.956 },
] as const;
const DESK_ITEMS = [
  { key: 'spinner',    label: 'спиннер',      h: 0.150 },
  { key: 'rubik',      label: 'кубик Рубика', h: 0.135 },
  { key: 'gum',        label: 'жвачка',       h: 0.062 },
  { key: 'headphones', label: 'наушники',     h: 0.190 },
  { key: 'phone',      label: 'телефон',      h: 0.230 },
] as const;
const ITEM_BY_KEY = new Map(DESK_ITEMS.map((it) => [it.key as string, it]));

/** Default desk wood — OldComicPageStyle.DESK (104, 78, 52). */
const DESK_DEFAULT = '#684e34';

/** IEEE crc32 (== python zlib.crc32 on ascii) — replicates the exporter's
 *  stable per-(slot,item) rotation jitter so the mock shows the real tilt. */
function crc32(s: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < s.length; i++) {
    let c = (crc ^ s.charCodeAt(i)) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
/** comic_desk_props._jitter_deg: [-14°, +14°], CCW-positive like PIL. */
function jitterDeg(slot: string, item: string): number {
  return ((crc32(`${slot}:${item}`) % 2801) / 2800) * 28 - 14;
}

/** One configured slot: item key + optional scale (1 = registry size). */
type SlotCfg = { item: string; scale: number };

/** project.settings.comicDeskProps ([{slot, item, scale?}]) → Record. */
function deskPropsOf(settings: unknown): Record<string, SlotCfg> {
  const arr = (settings as { comicDeskProps?: unknown } | null | undefined)?.comicDeskProps;
  const out: Record<string, SlotCfg> = {};
  if (Array.isArray(arr)) {
    for (const e of arr) {
      const slot = (e as { slot?: unknown } | null)?.slot;
      const item = (e as { item?: unknown } | null)?.item;
      const scale = (e as { scale?: unknown } | null)?.scale;
      if (typeof slot === 'string' && typeof item === 'string') {
        out[slot] = { item, scale: typeof scale === 'number' && scale > 0 ? scale : 1 };
      }
    }
  }
  return out;
}

function deskColorOf(settings: unknown): string {
  const s = (settings as { comicDeskColor?: unknown } | null | undefined)?.comicDeskColor;
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}

export default function ProjectExportSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error,  setError]  = useState<string | null>(null);

  const [exportType, setExportType] = useState<ExportType>('linear');
  const [transitionPreset, setTransitionPreset] = useState<TransitionPreset>('default');
  const [deskColor, setDeskColor] = useState<string>('');            // '' = default wood
  const [deskProps, setDeskProps] = useState<Record<string, SlotCfg>>({});
  const [initial, setInitial] = useState<string>('');                // JSON snapshot for dirty-check

  // TEMPORARY test-spread render (same endpoint as the PublishStepper button).
  const [testBusy, setTestBusy] = useState(false);
  const [testShownAt, setTestShownAt] = useState<number | null>(null);

  const snapshot = (et: ExportType, tp: TransitionPreset, dc: string, dp: Record<string, SlotCfg>) =>
    JSON.stringify([et, tp, dc, dp]);

  useEffect(() => {
    (async () => {
      try {
        setStatus('loading');
        const proj = await api.getProject(id);
        setProject(proj);
        const et = exportTypeOf(proj.settings);
        const tp = transitionPresetOf(proj.settings);
        const dc = deskColorOf(proj.settings);
        const dp = deskPropsOf(proj.settings);
        setExportType(et); setTransitionPreset(tp); setDeskColor(dc); setDeskProps(dp);
        setInitial(snapshot(et, tp, dc, dp));
        setStatus('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, [id]);

  if (status === 'loading' || !project) {
    return <main className="px-4 sm:px-8 py-6"><p className="text-zinc-500">Загрузка…</p></main>;
  }

  const dirty = snapshot(exportType, transitionPreset, deskColor, deskProps) !== initial;
  const isComic = exportType === 'comic' || exportType === 'comic_chunks';

  const save = async () => {
    setStatus('saving'); setError(null);
    try {
      // settings is replaced wholesale by PATCH — merge over the saved object,
      // clearing keys that are back at their defaults (same contract as the
      // settings page).
      const base = (project.settings as Record<string, unknown> | null) ?? {};
      const next = { ...base };
      if (exportType === 'comic' || exportType === 'comic_chunks') next.exportType = exportType;
      else delete next.exportType;
      if (transitionPreset === 'comic') next.transitionPreset = 'comic';
      else delete next.transitionPreset;
      if (deskColor) next.comicDeskColor = deskColor;
      else delete next.comicDeskColor;
      const entries = DESK_SLOTS
        .filter((s) => deskProps[s.key]?.item)
        .map((s) => {
          const cfg = deskProps[s.key];
          return Math.abs(cfg.scale - 1) > 0.001
            ? { slot: s.key, item: cfg.item, scale: cfg.scale }
            : { slot: s.key, item: cfg.item };
        });
      if (entries.length > 0) next.comicDeskProps = entries;
      else delete next.comicDeskProps;

      const proj = await api.updateProject(project.id, { settings: next });
      setProject(proj);
      setInitial(snapshot(exportType, transitionPreset, deskColor, deskProps));
      setStatus('saved');
      setTimeout(() => setStatus((s) => s === 'saved' ? 'idle' : s), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  const doTestSpread = async () => {
    setTestBusy(true); setError(null);
    try { await api.comicTestSpread(id); setTestShownAt(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setTestBusy(false); }
  };

  const cycleSlot = (slot: string) => {
    setDeskProps((d) => {
      const cur = d[slot]?.item ?? '';
      const keys = ['', ...DESK_ITEMS.map((it) => it.key as string)];
      const nextItem = keys[(keys.indexOf(cur) + 1) % keys.length];
      const next = { ...d };
      if (nextItem) next[slot] = { item: nextItem, scale: d[slot]?.scale ?? 1 };
      else delete next[slot];
      return next;
    });
  };

  return (
    <main className="px-4 sm:px-8 py-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Экспорт в CapCut</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Воркфлоу сборки драфта и вид стола для комикс-экспортов. Сам экспорт
            запускается на вкладке YouTube (шаг «Экспорт в CapCut»).
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {status === 'saved' && <span className="text-xs text-emerald-400">сохранено ✓</span>}
          <button
            onClick={save}
            disabled={status === 'saving' || !dirty}
            className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-1.5 rounded"
          >
            {status === 'saving' ? '…' : 'сохранить'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}

      <section className="space-y-4">
        <Row
          label="Тип экспорта"
          hint="project.settings.exportType — как собирается CapCut-драфт. «Линейный» = обычная лента шотов с простыми переходами. «Комикс» = фильм раскладывается на страницы-комиксы, камера летает по панелям с переворотами страниц, ОДНИМ драфтом. «Комикс по частям» = та же картинка, нарезанная на несколько лёгких драфтов + финальная сборка. Оба комикс-экспорта МЕДЛЕННЫЕ и пишут драфты прямо в папку CapCut — CapCut должен быть закрыт.">
          <select
            value={exportType}
            onChange={(e) => setExportType(e.target.value as ExportType)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
            <option value="linear">Линейный (простые переходы)</option>
            <option value="comic">Комикс (камера + переворот страниц)</option>
            <option value="comic_chunks">Комикс по частям (лёгкие драфты + сборка)</option>
          </select>
        </Row>

        {exportType === 'linear' && (
          <Row
            label="Переходы между шотами"
            hint="project.settings.transitionPreset — стиль переходов на стыках шотов. «Стандартный» = ротация 8 бесплатных переходов. «Комикс» = 漫画撕纸 (разрыв с угла) 90% + 便利贴 (стикер) 5% + 故障拼贴 (рваный коллаж) 5%. Комикс-переходы — VIP (нужен CapCut Pro).">
            <select
              value={transitionPreset}
              onChange={(e) => setTransitionPreset(e.target.value as TransitionPreset)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
              <option value="default">Стандартный (ротация 8 переходов)</option>
              <option value="comic">Комикс (разрыв 90% / стикер 5% / коллаж 5%)</option>
            </select>
          </Row>
        )}

        {isComic && (
          <>
            <Row
              label="Стол и предметы"
              hint="Живой макет листа: те же PNG, те же точки (SLOTS), тот же масштаб и наклон, что запечёт экспортер. Клик по пунктирной точке перебирает предметы; точнее — селекторами ниже. Предмет частично прячется ПОД журнал — так и задумано. Стопки страниц, панели и виньетка на макете условные.">
              <DeskMock
                projectId={id}
                deskColor={deskColor || DESK_DEFAULT}
                deskProps={deskProps}
                onSlotClick={cycleSlot}
              />
            </Row>

            <Row label="Цвет стола"
              hint="project.settings.comicDeskColor — '#rrggbb' подложки-дерева. Пусто = дефолт рендера (тёплый средне-коричневый). Слишком тёмный стол топит предметы в виньетке.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={deskColor || DESK_DEFAULT}
                  onChange={(e) => setDeskColor(e.target.value.toLowerCase())}
                  className="h-8 w-14 bg-zinc-950 border border-zinc-700 rounded cursor-pointer"
                />
                <code className="text-xs text-zinc-400">{deskColor || `${DESK_DEFAULT} (по умолчанию)`}</code>
                {deskColor && (
                  <button onClick={() => setDeskColor('')} className="text-xs text-zinc-400 hover:text-white underline">
                    сбросить
                  </button>
                )}
              </div>
            </Row>

            <Row label="Предметы по точкам" hint="Каждая точка стола опциональна. Масштаб 1 = размер из реестра (доля высоты кадра); экспортер читает его из comicDeskProps[].scale.">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                {DESK_SLOTS.map((s) => {
                  const cfg = deskProps[s.key];
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="text-[11px] text-zinc-500 w-24 shrink-0">{s.label}</span>
                      <select
                        value={cfg?.item ?? ''}
                        onChange={(e) => setDeskProps((d) => {
                          const next = { ...d };
                          if (e.target.value) next[s.key] = { item: e.target.value, scale: cfg?.scale ?? 1 };
                          else delete next[s.key];
                          return next;
                        })}
                        className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm">
                        <option value="">— пусто —</option>
                        {DESK_ITEMS.map((it) => (
                          <option key={it.key} value={it.key}>{it.label}</option>
                        ))}
                      </select>
                      <input
                        type="number" min={0.4} max={2.5} step={0.05}
                        value={cfg ? cfg.scale : 1}
                        disabled={!cfg}
                        onChange={(e) => {
                          const v = Number.parseFloat(e.target.value);
                          setDeskProps((d) => cfg
                            ? { ...d, [s.key]: { ...cfg, scale: Number.isFinite(v) ? v : 1 } }
                            : d);
                        }}
                        title="масштаб (1 = из реестра)"
                        className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-sm font-mono disabled:opacity-40"
                      />
                    </div>
                  );
                })}
              </div>
            </Row>

            {/* TEMPORARY (2026-08-01): реальный рендер первого разворота — тот же
                эндпоинт, что и кнопка на шаге экспорта. Удалить вместе с ним. */}
            <Row label="Проверка реальным рендером"
              hint="Рендерит ПЕРВЫЙ разворот настоящим пайплайном (стол, предметы, панели, стопки страниц) за десятки секунд — макет выше даёт расстановку, эта картинка — финальную правду. Сохрани настройки перед проверкой.">
              <button onClick={doTestSpread} disabled={testBusy || dirty}
                title={dirty ? 'Сначала сохрани настройки — рендер читает их из базы' : ''}
                className="text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">
                {testBusy ? '⏳ рендерю разворот…' : '🖼 Тестовый разворот'}
              </button>
              {testShownAt && (
                <a href={`${api.comicTestSpreadPngUrl(id)}?t=${testShownAt}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${api.comicTestSpreadPngUrl(id)}?t=${testShownAt}`}
                    alt="тестовый разворот"
                    className="mt-3 w-full rounded border border-zinc-700"
                  />
                </a>
              )}
            </Row>
          </>
        )}
      </section>
    </main>
  );
}

/** The live desk mock: a 16:9 sheet with the desk wood, a schematic open book
 *  (nearly full-sheet, like the render), and the ACTUAL sprites at the
 *  exporter's anchors/scale/tilt. Items sit UNDER the book layer, so the
 *  «tucked under the journal» crop matches the export. */
function DeskMock({
  projectId, deskColor, deskProps, onSlotClick,
}: {
  projectId: string;
  deskColor: string;
  deskProps: Record<string, SlotCfg>;
  onSlotClick: (slot: string) => void;
}) {
  // book footprint (fractions) ≈ _page_boxes on a busy spread: thin desk strips
  const BOOK = { l: 3.2, r: 3.2, t: 5.4, b: 7.6 };  // % of the canvas
  const panels = [0, 1] as const;                    // two pages
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-zinc-700 select-none"
      style={{
        aspectRatio: '16 / 9',
        backgroundColor: deskColor,
        // plank seams — a hint of the rendered wood grain
        backgroundImage: 'repeating-linear-gradient(180deg, transparent 0 21%, rgba(0,0,0,0.14) 21% 21.6%)',
      }}
    >
      {/* props — UNDER the book, exporter's tone-down + drop shadow */}
      {DESK_SLOTS.map((s) => {
        const cfg = deskProps[s.key];
        const it = cfg ? ITEM_BY_KEY.get(cfg.item) : undefined;
        if (!cfg || !it) return null;
        const rot = jitterDeg(s.key, cfg.item);
        return (
          <img
            key={s.key}
            src={api.deskPropSpriteUrl(projectId, cfg.item)}
            alt={it.label}
            className="absolute z-10"
            style={{
              left: `${s.cx * 100}%`,
              top: `${s.cy * 100}%`,
              height: `${it.h * cfg.scale * 100}%`,
              width: 'auto',
              maxWidth: 'none',
              // PIL rotates CCW-positive; CSS rotate is CW-positive → negate
              transform: `translate(-50%, -50%) rotate(${-rot}deg)`,
              filter: 'saturate(0.82) brightness(0.86) drop-shadow(2px 2px 3px rgba(0,0,0,0.55))',
            }}
          />
        );
      })}

      {/* the open book — covers the middle, props peek out from under it */}
      <div
        className="absolute z-20"
        style={{
          left: `${BOOK.l}%`, right: `${BOOK.r}%`, top: `${BOOK.t}%`, bottom: `${BOOK.b}%`,
          backgroundColor: '#eee2c4',
          boxShadow: '0 6px 14px rgba(0,0,0,0.45)',
        }}
      >
        {/* schematic 2×2 panels per page */}
        {panels.map((pg) => (
          <div key={pg} className="absolute grid grid-cols-2 grid-rows-2 gap-[1.2%] p-[1.6%]"
            style={{ left: pg === 0 ? '0%' : '50%', width: '50%', top: 0, bottom: 0 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ backgroundColor: '#d9ccab', border: '2px solid #181410' }} />
            ))}
          </div>
        ))}
        {/* soft binding shadow at the fold */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[9%]"
          style={{ background: 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(60,45,25,0.45), transparent 70%)' }} />
        {/* fore-edge: page stack sliver bottom-right (первый разворот — стопка справа) */}
        <div className="absolute right-[-0.6%] top-[2%] bottom-[-1.8%] w-[1.2%]"
          style={{ background: 'repeating-linear-gradient(90deg, #cebe9c 0 2px, #96865e 2px 3px)' }} />
        <div className="absolute left-[30%] right-[-0.6%] bottom-[-1.8%] h-[2.2%]"
          style={{ background: 'repeating-linear-gradient(0deg, #cebe9c 0 2px, #96865e 2px 3px)' }} />
      </div>

      {/* vignette, like the render's overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,0.42) 100%)' }} />

      {/* slot markers — clickable, cycle through the items */}
      {DESK_SLOTS.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onSlotClick(s.key)}
          title={`${s.label}: ${deskProps[s.key] ? (ITEM_BY_KEY.get(deskProps[s.key].item)?.label ?? '?') : 'пусто'} (клик — следующий предмет)`}
          className="absolute z-30 w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed cursor-pointer transition-colors"
          style={{
            left: `${Math.min(0.985, Math.max(0.015, s.cx)) * 100}%`,
            top: `${Math.min(0.97, Math.max(0.03, s.cy)) * 100}%`,
            borderColor: deskProps[s.key] ? 'rgba(52,211,153,0.9)' : 'rgba(251,191,36,0.8)',
            backgroundColor: 'rgba(0,0,0,0.25)',
          }}
        />
      ))}
    </div>
  );
}

/** div, not label: rows here hold SEVERAL controls (mock buttons, color input +
 *  reset, per-slot selects) — a shared label would re-route clicks to the first
 *  labelable element (e.g. open the color picker from the reset button). */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">{label}</div>
      {hint && <div className="text-[11px] text-zinc-600 mb-2 leading-snug">{hint}</div>}
      {children}
    </div>
  );
}
