'use client';

import { useEffect, useState } from 'react';
import { api, YoutubePackage, YoutubeAuthStatus, LaunchView, CapcutReadiness } from '@/lib/api';

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
  const [exported, setExported] = useState<{ draftPath?: string; sceneCount?: number; shotCount?: number } | null>(null);

  const load = () =>
    Promise.all([
      api.getYoutube(id), api.getYoutubeAuthStatus(), api.getLaunch(id),
      isMain ? api.capcutReadiness(id).catch(() => null) : Promise.resolve(null),
    ]).then(([p, s, v, r]) => {
      setPkg(p); setStatus(s); setView(v); setReadiness(r);
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

  // Steps 1-3 are local prep; 4-5 are driven by this item's launch status.
  const transcribed = myItem?.transcribeStatus === 'completed';
  const maxStep = !myItem ? 3 : transcribed ? 5 : 4;
  // Fresh asset → start at step 1 (params) and walk the prep steps in order.
  // Once prepared (files in), jump to the live status step (subtitles/upload).
  useEffect(() => { if (myItem) setActiveStep(maxStep); }, [maxStep, Boolean(myItem)]);

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
  const pick = async (field: 'video' | 'image', setter: (v: string) => void) => {
    setPicking(field);
    try { const r = await api.pickYoutubeFile(field); if (r.path) setter(r.path); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setPicking(null); }
  };

  const saveParams = () => act(async () => {
    await api.patchYoutube(id, isMain
      ? { main: { title: title.trim(), description: desc, tags: tagList } }
      : { shorts: { [itemKey]: { title: title.trim(), descBefore: desc, tags: tagList } } });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  });
  const doExport = () => act(async () => {
    if (isMain) {
      const r = await api.exportCapcut(id);
      setExported({ draftPath: r.draftPath, sceneCount: r.sceneCount, shotCount: r.shotCount });
    } else {
      const r = (await api.exportShorts(id, { only: itemKey })).shorts[0];
      setExported(r ? { draftPath: r.draft_path ?? r.draft_name } : {});
    }
  });
  const doPrepare = () => act(() => api.prepareLaunchItem(id, { key: itemKey, kind, slug, videoPath: videoPath.trim(), thumbPath: thumbPath.trim() }));
  const doUpload  = () => act(() => api.uploadLaunchItem(id, itemKey));

  const labels = ['Параметры', 'CapCut', 'Файл', 'Субтитры', 'Заливка'];

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
      {shownStep === 2 && (
        <Section n={2} title="Экспорт в CapCut">
          <p className="text-xs text-zinc-500 mb-3">Соберу CapCut-драфт. Доступно в любой момент — можно монтировать, пока основное ещё не готово. Дальше рендеришь сам и на шаге 3 указываешь путь к готовому mp4.</p>
          <button onClick={doExport} disabled={busy || (isMain && readiness?.ready === false)}
            title={isMain && readiness?.ready === false ? 'Не все кадры готовы' : ''}
            className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-4 py-2 rounded">
            {busy ? '⏳…' : (isMain && readiness?.ready === false) ? '🎬 не готово' : '🎬 Экспорт в CapCut'}
          </button>
          {exported?.draftPath && (
            <div className="mt-3 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-3 text-xs">
              <p className="text-fuchsia-200">✓ draft{exported.sceneCount ? ` — ${exported.sceneCount} сцен, ${exported.shotCount} кадров` : ''}</p>
              <code className="block text-fuchsia-100/80 font-mono break-all mt-1">{exported.draftPath}</code>
            </div>
          )}
          <div className="mt-3"><button onClick={() => setActiveStep(3)} className="text-sm text-zinc-300 hover:text-white">Готово, дальше →</button></div>
        </Section>
      )}

      {/* 3 — файл */}
      {shownStep === 3 && (
        <Section n={3} title="Файл (готовый mp4 из CapCut)">
          {isCurrent ? (
            <>
              <PathRow label="mp4" value={videoPath} picking={picking === 'video'} onPick={() => pick('video', setVideoPath)} onChange={setVideoPath} required />
              <PathRow label={`обложка${isMain ? '' : ' (необязательно)'}`} value={thumbPath} picking={picking === 'image'} onPick={() => pick('image', setThumbPath)} onChange={setThumbPath} required={isMain} />
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

      {/* 4 — субтитры */}
      {shownStep === 4 && (
        <Section n={4} title="Субтитры">
          <p className="text-xs text-zinc-500 mb-3">Транскрибирую mp4 (faster-whisper, GPU, в очереди рендера). Дальше нельзя, пока не готово.</p>
          <StatusRow label="Субтитры" state={myItem?.transcribeStatus ?? null} done="✓ готовы" running="⏳ транскрибирую…" pending="в очереди…" />
        </Section>
      )}

      {/* 5 — заливка */}
      {shownStep === 5 && (
        <Section n={5} title="Заливка (Unlisted)">
          <p className="text-xs text-zinc-500 mb-3">Гружу как «доступ по ссылке» + цепляю субтитры + плейлист. Публикация — потом в «Связке».</p>
          <StatusRow label="Видео" state={myItem?.uploaded ? 'completed' : myItem?.uploadError ? 'failed' : myItem?.uploadJobId ? 'running' : 'pending'}
            done="✓ залито (Unlisted)" running="⏳ заливаю…" pending="—" error={myItem?.uploadError} />
          {myItem?.uploaded && myItem.videoId && (
            <a href={`https://youtu.be/${myItem.videoId}`} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[11px] text-blue-400 hover:underline">▶ youtu.be/{myItem.videoId}</a>
          )}
          {isCurrent && !upRunning && !myItem?.uploaded && (
            <div className="mt-2"><button onClick={doUpload} disabled={busy} className="text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded">{busy ? '…' : '▲ Залить (Unlisted)'}</button></div>
          )}
          {myItem?.uploaded && (
            <p className="mt-3 text-xs text-emerald-300">Готово. Публиковать — на вкладке <a href={`/projects/${id}/youtube/launch`} className="underline">🔗 Связка-запуск</a>.</p>
          )}
        </Section>
      )}
    </div>
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
function StatusRow({ label, state, done, running, pending, error }: {
  label: string; state: string | null; done: string; running: string; pending: string; error?: string | null;
}) {
  const color = state === 'completed' ? 'text-emerald-400' : state === 'failed' ? 'text-red-400' : 'text-zinc-400';
  const text  = state === 'completed' ? done : state === 'failed' ? `✗ ${error ?? 'ошибка'}` : state === 'running' ? running : pending;
  return <div className="flex items-center justify-between border border-zinc-800 rounded px-3 py-2 text-sm"><span className="text-zinc-300">{label}</span><span className={`text-xs ${color}`}>{text}</span></div>;
}
function lim(n: number, max: number) { return `${n}/${max}${n > max ? ' ⚠' : ''}`; }
function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap break-all">{msg}</div>;
}
