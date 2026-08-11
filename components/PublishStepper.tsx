'use client';

import { useEffect, useState } from 'react';
import { api, YoutubePackage, YoutubeAuthStatus, LaunchView, CapcutReadiness, ComicChunk, ThumbnailJob } from '@/lib/api';

// Which CapCut export the MAIN video uses, read from Project.settings.exportType.
// 'comic' → the slow film→comic-spreads export; anything else → linear.
// 'comic_chunks' = the same comic picture, but rendered as several small drafts the
// user exports one by one and we reassemble into one light final draft.
type ExportType = 'linear' | 'comic' | 'comic_chunks';
function exportTypeOf(settings: unknown): ExportType {
  const s = (settings as { exportType?: unknown } | null | undefined)?.exportType;
  return s === 'comic' || s === 'comic_chunks' ? s : 'linear';
}

// Reusable per-asset publish stepper (MAIN video or one SHORT). 5 steps, ending
// at an Unlisted upload — the actual publish (link + schedule) lives in «Связка».
//   1 Параметры → 2 CapCut → 3 Файл → 4 Субтитры → 5 Заливка (Unlisted)
const TITLE_MAX = 100, DESC_MAX = 5000, TAGS_MAX = 500;
// YouTube's 500-char tag budget: chars + 2 quotes for a multiword tag + 1 comma.
const tagsChars = (tags: string[]) => tags.reduce((n, t, i) => n + t.length + (t.includes(' ') ? 2 : 0) + (i > 0 ? 1 : 0), 0);

export function PublishStepper({ id, kind, slug, title: assetTitle }: {
  id: string; kind: 'main' | 'short'; slug?: string; title?: string;
}) {
  const isMain  = kind === 'main';
  const itemKey = isMain ? 'main' : (slug ?? '');

  const [pkg,    setPkg]    = useState<YoutubePackage | null>(null);
  const [status, setStatus] = useState<YoutubeAuthStatus | null>(null);
  const [view,   setView]   = useState<LaunchView | null>(null);
  const [readiness, setReadiness] = useState<CapcutReadiness | null>(null);
  const [exportType, setExportType] = useState<ExportType>('linear');
  // packaging edit
  const [title, setTitle] = useState('');
  const [desc,  setDesc]  = useState('');
  const [tags,  setTags]  = useState('');
  const [saved, setSaved] = useState(false);
  // files
  const [videoPath, setVideoPath] = useState('');
  const [thumbPath, setThumbPath] = useState('');
  // stepper
  const [activeStep, setActiveStep] = useState(1);
  const [busy,    setBusy]    = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [err,     setErr]     = useState<string | null>(null);
  const [exported, setExported] = useState<{ draftPath?: string; draftName?: string; sceneCount?: number; shotCount?: number; spreads?: number } | null>(null);
  // Comic build runs async on the backend; we poll its status and show progress.
  const [comicProgress, setComicProgress] = useState<{ rendered: number; total: number } | null>(null);
  // Live build state, polled from the backend rather than tracked in this tab:
  // the build is detached and outlives the request that started it, so a reload
  // (or a second tab, or another machine) has to be able to see it too.
  const [comicLive, setComicLive] = useState<{
    rendered: number; total: number; building: boolean; done: boolean; draftName: string;
    spreads: number; spreadsTotal: number; turns: number; turnsTotal: number;
    phase: 'spreads' | 'turns' | 'draft' | 'done'; percent: number;
  } | null>(null);
  // Chunked comic: the plan (with per-chunk «draft written?»), the mp4 path the user
  // gives back for each part, and the assembled final draft.
  const [chunks, setChunks] = useState<(ComicChunk & { drafted: boolean })[]>([]);
  const [chunkPaths, setChunkPaths] = useState<Record<number, string>>({});
  const [assembled, setAssembled] = useState<{ draft_name: string; draft_path: string } | null>(null);
  // TEMPORARY (2026-08-01): one-spread test render — own busy flag so it never
  // locks the real export button; the timestamp doubles as the img cache-buster.
  const [testBusy, setTestBusy] = useState(false);
  const [testShownAt, setTestShownAt] = useState<number | null>(null);

  const load = () =>
    Promise.all([
      api.getYoutube(id), api.getYoutubeAuthStatus(), api.getLaunch(id),
      isMain ? api.capcutReadiness(id).catch(() => null) : Promise.resolve(null),
      isMain ? api.getProject(id).catch(() => null) : Promise.resolve(null),
    ]).then(([p, s, v, r, proj]) => {
      setPkg(p); setStatus(s); setView(v); setReadiness(r);
      if (proj) setExportType(exportTypeOf(proj.settings));
      const pk = isMain ? p.main : (p.shorts?.[itemKey] ?? { title: '', descBefore: '', tags: [] });
      setTitle(pk.title ?? '');
      setDesc(isMain ? (p.main.description ?? '') : (p.shorts?.[itemKey]?.descBefore ?? ''));
      setTags((pk.tags ?? []).join(', '));
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { load(); }, [id, itemKey]);

  const myItem = view?.items.find((i) => i.key === itemKey);
  const subsRunning = myItem && (myItem.transcribeStatus === 'pending' || myItem.transcribeStatus === 'running');
  const upRunning   = myItem && myItem.uploadJobId && !myItem.videoId && !myItem.uploadError;
  useEffect(() => {
    if (!subsRunning && !upRunning) return;
    const t = setTimeout(() => api.getLaunch(id).then(setView).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [view, subsRunning, upRunning, id]);

  // The chunked comic export needs one step the others don't: the picture is
  // rendered as several drafts, so between «собрать» and «файл» there is a stage
  // where each chunk is exported to mp4 and its path handed back. Step numbers are
  // therefore computed, not literal — everything after the extra step shifts by one.
  const isChunked = isMain && exportType === 'comic_chunks';
  const S_EXPORT = 2;                    // собрать драфт(ы) в CapCut
  const S_PARTS  = isChunked ? 3 : 0;    // пути к отрендеренным частям (только chunked)
  const S_FILE   = isChunked ? 4 : 3;
  const S_SUBS   = isChunked ? 5 : 4;
  const S_UPLOAD = isChunked ? 6 : 5;

  /**
   * Subtitles are OPTIONAL on a short (user, 2026-08-11). The step stays — the
   * operator can still put a short on transcription and have the .srt attached at
   * upload — it simply must not hold the upload hostage: a 9:16 frame already
   * carries a burned-in caption band, and nothing is auto-transcribed for shorts
   * any more, so waiting for a job that was never queued would block forever.
   */
  const subsOptional = !isMain;
  // Prep steps are local; the last two are driven by this item's launch status.
  const transcribed = myItem?.transcribeStatus === 'completed';
  const maxStep = !myItem ? S_FILE : (transcribed || subsOptional) ? S_UPLOAD : S_SUBS;
  // Fresh asset → start at step 1 (params) and walk the prep steps in order.
  // Once prepared (files in), jump to the live status step (subtitles/upload).
  useEffect(() => { if (myItem) setActiveStep(maxStep); }, [maxStep, Boolean(myItem)]);

  // Poll the comic build for as long as the comic export is the selected one.
  // No draft name is passed: the backend reports the current build from the
  // manifest, which is what makes progress visible after a page reload.
  useEffect(() => {
    if (!isMain || exportType !== 'comic') { setComicLive(null); return; }
    let stopped = false;
    const tick = () => api.comicStatus(id)
      .then((st) => { if (!stopped) setComicLive(st.spreadsTotal > 0 ? st : null); })
      .catch(() => { /* transient — keep the last known state */ });
    void tick();
    const t = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(t); };
  }, [id, isMain, exportType]);

  // Same idea for the chunked build: the plan lives on disk, so a reload keeps
  // showing which parts are already drafted and ready to be rendered to mp4.
  useEffect(() => {
    if (!isMain || exportType !== 'comic_chunks') { setChunks([]); return; }
    let stopped = false;
    const tick = () => api.comicChunksStatus(id)
      .then((st) => { if (!stopped) setChunks(st.chunks); })
      .catch(() => { /* transient — keep the last known state */ });
    tick();
    const t = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(t); };
  }, [id, isMain, exportType]);

  if (err && !pkg) return <Err msg={err} />;
  if (!pkg || !view) return <p className="text-zinc-500">Загрузка…</p>;

  const connected = status?.connected === true;
  const shownStep = Math.min(activeStep, maxStep);
  const isCurrent = shownStep === maxStep;
  const uploaded  = !!myItem?.uploaded;    // already on YouTube (Unlisted) — params are frozen
  const parseTags = (s: string) => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  const tagList  = parseTags(tags);
  const tagCount = tagsChars(tagList);
  const titleOver = title.length > TITLE_MAX, descOver = desc.length > DESC_MAX, tagsOver = tagCount > TAGS_MAX;
  const canSave  = title.trim() !== '' && !titleOver && !descOver && !tagsOver;
  const paramsOk = canSave && tagList.length > 0;   // tags required to proceed

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  // `key` separates concurrent pickers in the UI: the chunk step has one row per
  // part, all of them picking a 'video', so keying by field alone would light up
  // every row's spinner at once.
  const pick = async (field: 'video' | 'image', setter: (v: string) => void, key: string = field) => {
    setPicking(key);
    try { const r = await api.pickYoutubeFile(field); if (r.path) setter(r.path); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setPicking(null); }
  };

  const saveParams = () => act(async () => {
    await api.patchYoutube(id, isMain
      ? { main: { title: title.trim(), description: desc, tags: tagList } }
      : { shorts: { [itemKey]: { title: title.trim(), descBefore: desc, tags: tagList } } });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  });
  const doAssemble = () => act(async () => {
    const files = chunks.map((c) => ({ part: c.part, path: (chunkPaths[c.part] ?? '').trim() }));
    setAssembled(await api.assembleComicChunks(id, files));
  });
  const doExport = () => act(async () => {
    if (isMain) {
      if (exportType === 'comic_chunks') {
        // Slice + render every chunk draft. The POST returns the plan at once; the
        // renders run detached, so poll the plan's per-chunk «drafted» flags.
        const r = await api.exportComicChunks(id);
        setChunks(r.chunks.map((c) => ({ ...c, drafted: false })));
        const started = Date.now();
        for (;;) {
          await new Promise((res) => setTimeout(res, 4500));
          let st: { done: boolean; building: boolean; drafted: number; total: number;
                    chunks: (ComicChunk & { drafted: boolean })[] };
          try { st = await api.comicChunksStatus(id); }
          catch { continue; }                       // transient — keep polling
          setChunks(st.chunks);
          if (st.done) break;
          if (!st.building && st.drafted === 0 && Date.now() - started > 20_000) {
            throw new Error('Сборка частей не запустилась — см. data/<slug>/exports/comic/comic_build.log');
          }
          if (Date.now() - started > 60 * 60_000) {
            throw new Error('Ожидание сборки частей превысило 60 мин — прервано (сборка могла продолжаться в фоне).');
          }
        }
      } else if (exportType === 'comic') {
        // Async build: the POST returns immediately with a draft name; the render
        // runs detached on the backend. Poll status until the draft is written.
        const r = await api.exportComic(id);
        setComicProgress({ rendered: 0, total: r.spreads });
        const started = Date.now();
        for (;;) {
          await new Promise((res) => setTimeout(res, 4500));
          let st: { done: boolean; building: boolean; rendered: number; total: number };
          try { st = await api.comicStatus(id, r.draft_name); }
          catch { continue; }                       // transient — keep polling
          setComicProgress({ rendered: st.rendered, total: st.total || r.spreads });
          if (st.done) break;
          if (!st.building && st.rendered === 0 && Date.now() - started > 20_000) {
            throw new Error('Сборка комикса не запустилась — см. data/<slug>/exports/comic/comic_build.log');
          }
          if (Date.now() - started > 30 * 60_000) {
            throw new Error('Ожидание сборки комикса превысило 30 мин — прервано (сборка могла продолжаться в фоне).');
          }
        }
        setComicProgress(null);
        setExported({ draftName: r.draft_name, spreads: r.spreads });
      } else {
        const r = await api.exportCapcut(id);
        setExported({ draftPath: r.draftPath, sceneCount: r.sceneCount, shotCount: r.shotCount });
      }
    } else {
      const r = (await api.exportShorts(id, { only: itemKey })).shorts[0];
      setExported(r ? { draftPath: r.draft_path ?? r.draft_name } : {});
    }
  });
  // TEMPORARY (2026-08-01): render the FIRST spread as one PNG — fast eyeball
  // check of the desk/props/paper styling without a draft build. Delete with
  // the backend endpoint.
  const doTestSpread = async () => {
    setTestBusy(true); setErr(null);
    try { await api.comicTestSpread(id); setTestShownAt(Date.now()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setTestBusy(false); }
  };
  const doPrepare = () => act(() => api.prepareLaunchItem(id, { key: itemKey, kind, slug, videoPath: videoPath.trim(), thumbPath: thumbPath.trim() }));
  const doUpload  = () => act(() => api.uploadLaunchItem(id, itemKey));
  // Only reachable for a short: the main video is queued automatically at prepare.
  const doTranscribe = () => act(() => api.transcribeLaunchItem(id, itemKey));
  const doFixThumb    = () => act(() => api.retryLaunchThumbnail(id, itemKey));
  const doThumbManual = () => act(() => api.confirmLaunchThumbnailManual(id, itemKey));

  const labels = isChunked
    ? ['Параметры', 'Части в CapCut', 'Пути к частям', 'Файл', 'Субтитры', 'Заливка']
    : ['Параметры', 'CapCut', 'Файл', 'Субтитры', 'Заливка'];

  return (
    <div>
      {!connected && (
        <div className="mb-4 bg-red-950/40 border border-red-800 rounded p-3 text-sm">
          Канал не подключён — <a className="underline text-red-300" href={api.youtubeOAuthUrl()} target="_blank" rel="noreferrer">подключить</a>.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-5 text-[11px]">
        {labels.map((l, i) => {
          const n = i + 1, reachable = n <= maxStep, active = n === shownStep, done = n < maxStep;
          const circle = active ? 'bg-red-700 text-white' : done ? 'bg-emerald-700 text-white' : reachable ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-600';
          return (
            <div key={l} className="flex items-center gap-1">
              <button type="button" disabled={!reachable} onClick={() => setActiveStep(n)} className={`flex items-center gap-1 ${reachable ? 'hover:opacity-80' : 'cursor-default'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center font-medium ${circle}`}>{done && !active ? '✓' : n}</span>
                <span className={active ? 'text-zinc-200' : reachable ? 'text-zinc-400' : 'text-zinc-600'}>{l}</span>
              </button>
              {n < labels.length && <span className="text-zinc-700 mx-0.5">→</span>}
            </div>
          );
        })}
      </div>

      {err && <div className="mb-3"><Err msg={err} /></div>}

      {/* 1 — параметры */}
      {shownStep === 1 && (
        <Section n={1} title="Параметры">
          <FLabel over={titleOver}>Название {lim(title.length, TITLE_MAX)}</FLabel>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploaded}
            className={`w-full bg-zinc-950 border rounded px-2 py-1.5 text-sm mb-3 disabled:opacity-60 ${titleOver ? 'border-red-700' : 'border-zinc-700'}`} />
          <FLabel over={descOver}>Описание {lim(desc.length, DESC_MAX)}</FLabel>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={isMain ? 10 : 5} disabled={uploaded}
            className={`w-full bg-zinc-950 border rounded px-2 py-1.5 text-sm mb-3 disabled:opacity-60 ${descOver ? 'border-red-700' : 'border-zinc-700'}`} />
          <FLabel over={tagsOver}>Теги ({tagList.length} шт · {lim(tagCount, TAGS_MAX)} симв)</FLabel>
          <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={3} disabled={uploaded}
            className={`w-full bg-zinc-950 border rounded px-2 py-1.5 text-xs font-mono mb-1 disabled:opacity-60 ${tagsOver ? 'border-red-700' : 'border-zinc-700'}`} />
          {tagList.length === 0 && <p className="text-[11px] text-amber-400 mb-2">Теги обязательны для перехода дальше.</p>}
          <p className="text-[11px] text-zinc-500 mb-3">Плейлист — авто ({isMain ? '«Это вся твоя жизнь»' : '«шорты»'}).</p>
          {uploaded ? (
            <p className="text-[11px] text-zinc-500">Видео уже залито — параметры зафиксированы. Меняй в YouTube Studio.</p>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={saveParams} disabled={busy || !canSave} className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded">
                {busy ? '…' : 'Сохранить'}
              </button>
              {saved && <span className="text-emerald-400 text-xs">✓ сохранено</span>}
              <button onClick={() => setActiveStep(2)} disabled={!paramsOk} title={!paramsOk ? 'Заполни заголовок + теги в пределах лимитов' : ''} className="ml-auto text-sm text-zinc-300 hover:text-white disabled:opacity-40">Далее →</button>
            </div>
          )}
        </Section>
      )}

      {/* 2 — CapCut */}
      {shownStep === S_EXPORT && (() => {
        const isComic = isMain && exportType === 'comic';
        return (
        <Section n={S_EXPORT} title={isChunked ? 'Сборка частей комикса' : isComic ? 'Экспорт комикса в CapCut' : 'Экспорт в CapCut'}>
          {isChunked ? (
            <p className="text-xs text-zinc-500 mb-3">Разложу фильм на страницы-комиксы и соберу его НЕ одним драфтом, а несколькими лёгкими — по 4 разворота (~36 МБ каждый), которые CapCut открывает без мучений. Части немые: озвучка, музыка и субтитры лягут в финальный драфт, чтобы править их один раз. Каждая часть заканчивается переворотом страницы, так что на склейке шва не будет. Сборка медленная — несколько минут на часть.</p>
          ) : isComic ? (
            <p className="text-xs text-zinc-500 mb-3">Разложу фильм на страницы-комиксы и соберу CapCut-драфт с полётом камеры по панелям и переворотами страниц. Экспорт медленный — может занять несколько минут. По готовности рендеришь сам и на шаге 3 указываешь путь к готовому mp4.</p>
          ) : (
            <p className="text-xs text-zinc-500 mb-3">Соберу CapCut-драфт. Доступно в любой момент — можно монтировать, пока основное ещё не готово. Дальше рендеришь сам и на шаге 3 указываешь путь к готовому mp4.</p>
          )}
          {isChunked && chunks.length > 0 && (
            <div className="mb-3 border border-zinc-700 rounded divide-y divide-zinc-800">
              {chunks.map((c) => (
                <div key={c.part} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span className="text-zinc-400 w-14">{c.part}/{c.of}</span>
                  <span className="font-mono text-zinc-300 flex-1 truncate">{c.draft_name}</span>
                  <span className="text-zinc-500">развороты {c.spread_from}–{c.spread_to}</span>
                  <span className="text-zinc-500 w-16 text-right">{(c.expected_us / 1e6 / 60).toFixed(1)} мин</span>
                  <span className={c.drafted ? 'text-emerald-400' : 'text-zinc-600'}>{c.drafted ? '✓ собран' : '…'}</span>
                </div>
              ))}
            </div>
          )}
          {(isComic || isChunked) && (
            <div className="mb-3 bg-amber-950/40 border border-amber-700 rounded p-3 text-xs text-amber-200">
              ⚠ Закройте CapCut перед экспортом комикса — открытый CapCut удалит черновик при закрытии. Сборка идёт в отдельном процессе: вкладку можно закрыть и даже перезапустить сервер, прогресс ниже подхватится снова.
            </div>
          )}
          {/* TEMPORARY (2026-08-01): быстрая проверка вида стола/предметов одним
              разворотом, без сборки драфта. Удалить вместе с эндпоинтом. */}
          {(isComic || isChunked) && (
            <div className="mb-3 border border-zinc-800 rounded p-3">
              <div className="flex items-center gap-3">
                <button onClick={doTestSpread} disabled={testBusy}
                  className="text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-3 py-1.5 rounded shrink-0">
                  {testBusy ? '⏳ рендерю разворот…' : '🖼 Тестовый разворот'}
                </button>
                <span className="text-[11px] text-zinc-600 leading-snug">
                  Временная кнопка: рендерит ПЕРВЫЙ разворот одной картинкой (стол, предметы,
                  панели, стопки страниц) за десятки секунд — проверить вид, не собирая драфт.
                </span>
              </div>
              {testShownAt && (
                <a href={`${api.comicTestSpreadPngUrl(id)}?t=${testShownAt}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${api.comicTestSpreadPngUrl(id)}?t=${testShownAt}`}
                    alt="тестовый разворот"
                    className="mt-3 w-full rounded border border-zinc-700"
                  />
                </a>
              )}
            </div>
          )}
          <button onClick={doExport} disabled={busy || (isMain && readiness?.ready === false)}
            title={isMain && readiness?.ready === false ? 'Не все кадры готовы' : ''}
            className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-4 py-2 rounded">
            {busy
              ? (isChunked
                  ? (chunks.length
                      ? `⏳ собираю части… ${chunks.filter((c) => c.drafted).length}/${chunks.length}`
                      : '⏳ режу на части…')
                  : isComic
                    ? (comicProgress
                        ? `⏳ собираю комикс… ${comicProgress.rendered}/${comicProgress.total} разворотов`
                        : '⏳ запускаю сборку…')
                    : '⏳…')
              : (isMain && readiness?.ready === false)
                ? '🎬 не готово'
                : isChunked ? '🎬 Собрать части комикса'
                  : isComic ? '🎬 Экспорт комикса в CapCut' : '🎬 Экспорт в CapCut'}
          </button>
          {isComic && comicLive && (
            <div className="mt-3 bg-zinc-900 border border-zinc-700 rounded p-3">
              <div className="flex items-baseline justify-between text-xs mb-2">
                <span className={comicLive.done ? 'text-emerald-300' : comicLive.building ? 'text-amber-300' : 'text-zinc-400'}>
                  {comicLive.done
                    ? '✓ черновик собран — открывайте CapCut'
                    : !comicLive.building
                      ? `⏸ сборка прервалась (${comicLive.phase === 'turns' ? 'на переходах' : 'на разворотах'})`
                      : comicLive.phase === 'spreads'
                        ? `⏳ развороты — ${comicLive.spreads} из ${comicLive.spreadsTotal}`
                        : comicLive.phase === 'turns'
                          ? `⏳ переходы между страницами — ${comicLive.turns} из ${comicLive.turnsTotal}`
                          : '⏳ собираю CapCut-черновик…'}
                </span>
                <span className="text-zinc-500 font-mono">{comicLive.percent}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                <div
                  className={`h-full transition-all ${comicLive.done ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, comicLive.percent)}%` }}
                />
              </div>
              {/* Both phases, so a full spread count no longer reads as "done". */}
              <div className="flex gap-4 text-[11px] text-zinc-500 mt-1.5 font-mono">
                <span>развороты {comicLive.spreads}/{comicLive.spreadsTotal}</span>
                <span>переходы {comicLive.turns}/{comicLive.turnsTotal}</span>
              </div>
              <p className="text-[11px] text-zinc-600 mt-2 font-mono break-all">{comicLive.draftName}</p>
              {!comicLive.done && !comicLive.building && comicLive.rendered > 0 && (
                <p className="text-[11px] text-zinc-500 mt-1">
                  Ничего нового не появлялось больше пяти минут — сборка, похоже, прервалась. Запустите экспорт заново.
                </p>
              )}
            </div>
          )}

          {(exported?.draftPath || exported?.draftName) && (
            <div className="mt-3 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-3 text-xs">
              <p className="text-fuchsia-200">
                ✓ {exported.draftName ? `«${exported.draftName}»` : 'draft'}
                {exported.spreads ? ` — ${exported.spreads} разворотов` : exported.sceneCount ? ` — ${exported.sceneCount} актов, ${exported.shotCount} кадров` : ''}
                {isComic ? ' — черновик в списке CapCut' : ''}
              </p>
              {exported.draftPath && (
                <code className="block text-fuchsia-100/80 font-mono break-all mt-1">{exported.draftPath}</code>
              )}
            </div>
          )}
          <div className="mt-3"><button onClick={() => setActiveStep(isChunked ? S_PARTS : S_FILE)} className="text-sm text-zinc-300 hover:text-white">Готово, дальше →</button></div>
        </Section>
        );
      })()}

      {/* 3 — файл */}
      {/* 3 — пути к отрендеренным частям (только «комикс по частям») */}
      {isChunked && shownStep === S_PARTS && (
        <Section n={S_PARTS} title="Пути к отрендеренным частям">
          <p className="text-xs text-zinc-500 mb-3">
            Открой каждую часть в CapCut и отрендери в mp4 — <b>с одинаковыми настройками</b> (1080p, 30 fps) во всех.
            Ничего в них не меняй: звук и субтитры кладутся сюда отдельно. Потом впиши путь к каждому файлу и жми «Собрать».
            Длительности я замерю по факту и по ним расставлю озвучку, музыку и субтитры — так накопительного рассинхрона не будет,
            даже если CapCut отдаст часть на пару кадров длиннее расчётной.
          </p>
          <p className="text-[11px] text-zinc-500 mb-3">📁 открывает обычный диалог выбора файла — вписывать путь руками не нужно.</p>
          {chunks.length === 0 ? (
            <p className="text-xs text-amber-400">Частей пока нет — вернись на шаг {S_EXPORT} и собери их.</p>
          ) : (
            <>
              <div className="space-y-2 mb-3">
                {chunks.map((c) => {
                  const val = chunkPaths[c.part] ?? '';
                  const set = (v: string) => setChunkPaths((p) => ({ ...p, [c.part]: v }));
                  return (
                    <div key={c.part} className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400 w-24 shrink-0">
                        {c.part}/{c.of} <span className="text-zinc-600">·{(c.expected_us / 1e6 / 60).toFixed(1)}м</span>
                      </span>
                      <span className={`text-xs w-20 shrink-0 ${c.drafted ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {c.drafted ? '✓ собран' : 'не собран'}
                      </span>
                      <input
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        placeholder={`mp4 части ${c.part} — ${c.draft_name}`}
                        className={`flex-1 min-w-0 bg-zinc-950 border rounded px-2 py-1.5 text-xs font-mono ${val.trim() ? 'border-zinc-700' : 'border-red-900'}`} />
                      <button
                        onClick={() => pick('video', set, `part-${c.part}`)}
                        disabled={picking === `part-${c.part}`}
                        title="Выбрать файл"
                        className="shrink-0 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded disabled:opacity-50">
                        {picking === `part-${c.part}` ? '…' : '📁'}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={doAssemble}
                  disabled={busy || chunks.some((c) => !(chunkPaths[c.part] ?? '').trim())}
                  title={chunks.some((c) => !(chunkPaths[c.part] ?? '').trim()) ? 'Укажи путь для каждой части' : ''}
                  className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-4 py-2 rounded">
                  {busy ? '⏳ собираю…' : '🎬 Собрать финальный драфт'}
                </button>
                {assembled && <span className="text-emerald-400 text-xs">✓ {assembled.draft_name} — открывай в CapCut</span>}
                <button onClick={() => setActiveStep(S_FILE)} className="ml-auto text-sm text-zinc-300 hover:text-white">Далее →</button>
              </div>
              {assembled && (
                <p className="text-[11px] text-zinc-500 mt-2 font-mono break-all">{assembled.draft_path}</p>
              )}
            </>
          )}
        </Section>
      )}

      {shownStep === S_FILE && (
        <Section n={S_FILE} title="Файл (готовый mp4 из CapCut)">
          {isCurrent ? (
            <>
              <PathRow label="mp4" value={videoPath} picking={picking === 'video'} onPick={() => pick('video', setVideoPath)} onChange={setVideoPath} required />
              <PathRow label={`обложка${isMain ? '' : ' (необязательно)'}`} value={thumbPath} picking={picking === 'image'} onPick={() => pick('image', setThumbPath)} onChange={setThumbPath} required={isMain} />
              <ThumbnailPicker projectId={id} value={thumbPath} onPick={setThumbPath} />
              <button onClick={doPrepare} disabled={busy || !videoPath.trim() || (isMain && !thumbPath.trim()) || !connected}
                className="mt-3 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded">
                {busy ? '…' : '💬 Сгенерировать субтитры →'}
              </button>
            </>
          ) : (
            <div className="text-xs text-zinc-500 space-y-1">
              <div className="font-mono break-all">🎬 {myItem?.videoPath}</div>
              <div className="font-mono break-all">🖼 {myItem?.thumbPath || '(без обложки)'}</div>
            </div>
          )}
        </Section>
      )}

      {/* 4 — субтитры (для шорта необязательны) */}
      {shownStep === S_SUBS && (
        <Section n={S_SUBS} title={subsOptional ? 'Субтитры (необязательно)' : 'Субтитры'}>
          <p className="text-xs text-zinc-500 mb-3">
            {subsOptional
              ? 'Для шорта не обязательны: в вертикали уже есть вжатая полоса, а ютуб показывает свои автосубтитры. Можно сразу к заливке — или поставить транскрипцию, и если успеет, .srt прицепится при загрузке.'
              : 'Транскрибирую mp4 (faster-whisper, GPU, в очереди рендера). Дальше нельзя, пока не готово.'}
          </p>
          <StatusRow label="Субтитры" state={myItem?.transcribeStatus ?? null} done="✓ готовы" running="⏳ транскрибирую…"
            pending="в очереди…" absent="не запрошены" />
          {/* NOT gated on isCurrent: for a short the subtitles step is never the
              max step any more (the upload is), so an isCurrent check would hide
              this button in the exact state it exists for. */}
          {(!myItem?.transcribeStatus || myItem.transcribeStatus === 'failed') && (
            <div className="mt-2 flex gap-2">
              <button onClick={doTranscribe} disabled={busy}
                      className="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
                {busy ? '…'
                  : myItem?.transcribeStatus === 'failed' ? 'Повторить транскрипцию'
                  // Already on YouTube → the job also inserts the track, so say so.
                  : myItem?.uploaded ? 'Сделать субтитры и прицепить к залитому'
                  : 'Поставить субтитры на генерацию'}
              </button>
              {subsOptional && (
                <button onClick={() => setActiveStep(S_UPLOAD)}
                        className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded">
                  Пропустить →
                </button>
              )}
            </div>
          )}
        </Section>
      )}

      {/* 5 — заливка */}
      {shownStep === S_UPLOAD && (
        <Section n={S_UPLOAD} title="Заливка (Unlisted)">
          <p className="text-xs text-zinc-500 mb-3">Гружу как «доступ по ссылке» + цепляю субтитры + плейлист. Публикация — потом в «Связке».</p>
          <StatusRow label="Видео" state={myItem?.uploaded ? 'completed' : myItem?.uploadError ? 'failed' : myItem?.uploadJobId ? 'running' : 'pending'}
            done="✓ залито (Unlisted)" running="⏳ заливаю…" pending="—" error={myItem?.uploadError} />
          {myItem?.uploaded && myItem.videoId && (
            <a href={`https://youtu.be/${myItem.videoId}`} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[11px] text-blue-400 hover:underline">▶ youtu.be/{myItem.videoId}</a>
          )}
          {isCurrent && !upRunning && !myItem?.uploaded && (
            <div className="mt-2"><button onClick={doUpload} disabled={busy} className="text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded">{busy ? '…' : '▲ Залить (Unlisted)'}</button></div>
          )}

          {/* Cover — its own status line. Covers over the API's 2MB cap can't go
              through the API at all (and we don't re-encode the artwork), so this
              step hands the operator straight to Studio, where the cap is 50MB.
              Without this the video quietly went live with a frame grab. */}
          {myItem?.uploaded && myItem.thumbPath && (
            myItem.thumbnailMissing ? (
              <div className="mt-3 bg-amber-950/40 border border-amber-700 rounded p-3 text-xs">
                <p className="text-amber-200">
                  ⚠ Обложки на видео нет — сейчас там кадр из видео.
                  {myItem.thumbnailTooBig
                    ? ' Файл больше 2 МБ, а API принимает только до 2 МБ.'
                    : myItem.thumbnailError ? ` ${myItem.thumbnailError}` : ''}
                </p>
                <p className="text-[11px] text-amber-300/70 mt-1">
                  Ставим руками в Studio — там лимит 50 МБ и картинка уходит как есть, без пережатия.
                </p>
                <p className="text-[11px] text-zinc-400 mt-1.5 font-mono break-all">🖼 {myItem.thumbPath}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <a href={`https://studio.youtube.com/video/${myItem.videoId}/edit`} target="_blank" rel="noreferrer"
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded">
                    ↗ Открыть в Studio
                  </a>
                  <button onClick={() => navigator.clipboard?.writeText(myItem.thumbPath)}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded">
                    копировать путь
                  </button>
                  <button onClick={doThumbManual} disabled={busy}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
                    {busy ? '…' : '✓ Поставил обложку'}
                  </button>
                  {!myItem.thumbnailTooBig && (
                    <button onClick={doFixThumb} disabled={busy}
                      className="text-xs text-zinc-400 hover:text-zinc-200 underline disabled:opacity-50">
                      или отправить через API
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-emerald-400">🖼 обложка на месте</p>
            )
          )}
          {myItem?.uploaded && (
            <p className="mt-3 text-xs text-emerald-300">Готово. Публиковать — на вкладке <a href={`/projects/${id}/youtube/launch`} className="underline">🔗 Связка-запуск</a>.</p>
          )}
        </Section>
      )}
    </div>
  );
}

/**
 * Pick the cover straight out of the thumbnail workshop instead of hunting for a
 * file on disk. Two kinds of entry, and the difference matters:
 *
 *   готовая обложка — the promoted frame WITH the caption drawn on it, already
 *     squeezed under YouTube's 2MB API cap. This is what should ship.
 *   кандидат       — raw art, rendered with no lettering by design. Usable, but
 *     it goes up without a caption, so it is marked as such.
 */
function ThumbnailPicker({ projectId, value, onPick }: {
  projectId: string; value: string; onPick: (absPath: string) => void;
}) {
  const [jobs, setJobs] = useState<ThumbnailJob[] | null>(null);

  useEffect(() => {
    let stopped = false;
    void api.listThumbnailJobs(projectId)
      .then((rows) => { if (!stopped) setJobs(rows); })
      .catch(() => { if (!stopped) setJobs([]); });
    return () => { stopped = true; };
  }, [projectId]);

  if (!jobs) return null;

  const covers = jobs.filter((j) => j.chosenFilename && j.outputPath);
  const candidates = jobs.flatMap((j) =>
    (j.candidates ?? []).map((filename) => ({ job: j, filename })));
  if (covers.length === 0 && candidates.length === 0) return null;

  const Tile = ({ src, path, caption, note }: { src: string; path: string; caption: string; note?: string }) => (
    <button type="button" onClick={() => onPick(path)} title={path}
      className={`overflow-hidden rounded border text-left ${
        value === path ? 'border-purple-500 ring-2 ring-purple-500/40' : 'border-zinc-700 hover:border-zinc-500'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={caption} className="block aspect-video w-full object-cover" loading="lazy" />
      <div className="px-1.5 py-1 text-[10px] text-zinc-400">
        {caption}{note && <span className="text-zinc-600"> · {note}</span>}
      </div>
    </button>
  );

  return (
    <details className="mb-2" open={!value}>
      <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-zinc-400">
        выбрать из нагенеренных ({covers.length + candidates.length})
      </summary>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {covers.map((j) => (
          <Tile key={`cover-${j.id}`} src={api.thumbnailCoverUrl(projectId, j.completedAt ?? '')}
                path={j.outputPath!} caption="готовая обложка" note="с подписью" />
        ))}
        {candidates.map(({ job, filename }) => (
          <Tile key={`${job.id}-${filename}`}
                src={api.thumbnailCandidateUrl(projectId, job.id, filename)}
                path={`${job.artPath}\\${filename}`}
                caption={job.idea || 'кандидат'} note="без подписи" />
        ))}
      </div>
    </details>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4"><div className="text-sm font-medium text-zinc-200 mb-3">Шаг {n}. {title}</div>{children}</div>;
}
function FLabel({ over, children }: { over?: boolean; children: React.ReactNode }) {
  return <div className={`text-[11px] uppercase tracking-wider mb-1 ${over ? 'text-red-400' : 'text-zinc-400'}`}>{children}</div>;
}
function PathRow({ label, value, picking, onPick, onChange, required }: {
  label: string; value: string; picking: boolean; onPick: () => void; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div className="mb-2">
      <div className="text-[11px] text-zinc-400 uppercase tracking-wider mb-1">{label}{required && <span className="text-red-400">*</span>}</div>
      <div className="flex gap-2">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="путь к файлу"
          className={`flex-1 min-w-0 bg-zinc-950 border rounded px-2 py-1.5 text-xs font-mono ${value.trim() || !required ? 'border-zinc-700' : 'border-red-900'}`} />
        <button onClick={onPick} disabled={picking} className="shrink-0 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 rounded disabled:opacity-50">{picking ? '…' : '📁'}</button>
      </div>
    </div>
  );
}
function StatusRow({ label, state, done, running, pending, absent, error }: {
  label: string; state: string | null; done: string; running: string; pending: string;
  /** Text for state === null, i.e. NO job exists. Defaults to `pending` so the
   *  existing call sites keep their wording; pass it wherever "нет джоба" and
   *  "стоит в очереди" are different facts for the operator. Showing «в очереди…»
   *  for a job that was never created is exactly the inconsistency this fixes. */
  absent?: string;
  error?: string | null;
}) {
  const color = state === 'completed' ? 'text-emerald-400' : state === 'failed' ? 'text-red-400' : 'text-zinc-400';
  const text  = state === 'completed' ? done : state === 'failed' ? `✗ ${error ?? 'ошибка'}`
              : state === 'running' ? running : state === null ? (absent ?? pending) : pending;
  return <div className="flex items-center justify-between border border-zinc-800 rounded px-3 py-2 text-sm"><span className="text-zinc-300">{label}</span><span className={`text-xs ${color}`}>{text}</span></div>;
}
function lim(n: number, max: number) { return `${n}/${max}${n > max ? ' ⚠' : ''}`; }
function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap break-all">{msg}</div>;
}
