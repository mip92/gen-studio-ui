'use client';

import { useEffect, useState, use } from 'react';
import { api, ShortsPlan, ShortsPlanItem, YoutubePackage, YoutubeShort, ShortResult, YoutubeAuthStatus, YoutubeUploadResult, YoutubeUploadJob, YoutubeCaptionJob } from '@/lib/api';
import { YoutubeSubnav } from '@/components/YoutubeSubnav';

// Shorts tab: a gallery of the curated teaser reels. Each card previews the
// short with real frame thumbnails (9:16 crop — the same center-crop the cover
// fill produces); clicking a card opens the editor modal with the YouTube
// packaging (title / BEFORE and AFTER descriptions / tags), the link to the
// published short, and the per-short CapCut export.
export default function ShortsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [plan, setPlan] = useState<ShortsPlan | null>(null);
  const [pkg,  setPkg]  = useState<YoutubePackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [allResult, setAllResult] = useState<ShortResult[] | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    Promise.all([api.shortsPlan(id), api.getYoutube(id)])
      .then(([p, y]) => { setPlan(p); setPkg(y); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [id]);

  const buildAll = async () => {
    setBusyAll(true); setError(null); setAllResult(null);
    try { setAllResult((await api.exportShorts(id)).shorts); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyAll(false); }
  };

  if (error && !plan) return <main className="px-4 sm:px-8 py-6"><Err msg={error} /></main>;
  if (!plan || !pkg)  return <main className="px-4 sm:px-8 py-6"><p className="text-zinc-500">Загрузка…</p></main>;

  const openShort = openSlug ? plan.shorts.find((s) => s.slug === openSlug) : null;

  return (
    <main className="px-4 sm:px-8 py-6 max-w-5xl">
      <YoutubeSubnav id={id} />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Шорты</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Вертикальные тизеры (9:16) из готовых кадров. Клик по карточке — название, описание,
            теги, ссылка на опубликованный шорт и экспорт в CapCut.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setCreating(true)}
            className="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-2 rounded"
          >
            ＋ Новый шорт
          </button>
          {plan.hasPlan && (
            <button
              onClick={buildAll}
              disabled={busyAll}
              className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-3 py-2 rounded"
            >
              {busyAll ? '⏳ собираю…' : `📱 Собрать все (${plan.shorts.length})`}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4"><Err msg={error} /></div>}
      {allResult && (
        <div className="mb-4 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-3 text-xs text-fuchsia-200">
          ✓ собрано: {allResult.length} шорт(ов) — в списке проектов CapCut.
        </div>
      )}

      {!plan.hasPlan ? (
        <div className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded p-4">
          Плана шортов ещё нет. Нажми <b className="text-zinc-300">＋ Новый шорт</b> — файл{' '}
          <code className="text-zinc-400">scripts/&lt;slug&gt;_shorts_plan.json</code> создастся сам.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {plan.shorts.map((s) => (
            <ShortTile
              key={s.slug}
              short={s}
              pack={pkg.shorts[s.slug]}
              onOpen={() => { window.location.href = `/projects/${id}/youtube/shorts/${s.slug}`; }}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewShortModal
          projectId={id}
          onDone={() => { setCreating(false); load(); }}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}

// ── Gallery card ──────────────────────────────────────────────────────────────

function ShortTile({
  short, pack, onOpen,
}: {
  short:  ShortsPlanItem;
  pack:   YoutubeShort | undefined;
  onOpen: () => void;
}) {
  const cover  = short.preview.find((p) => p.shotId && p.image);
  const filled = !!pack && !!(pack.title || pack.descBefore || pack.descAfter);
  const url    = pack?.url?.trim();

  return (
    <div
      onClick={onOpen}
      className="relative aspect-[9/16] bg-zinc-900 border border-zinc-800 hover:border-fuchsia-700
                 rounded-lg overflow-hidden cursor-pointer group"
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={api.shotImageUrl(cover.shotId!, cover.image!)}
          alt={short.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-700 text-3xl">🎬</div>
      )}

      {/* status badges */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-1">
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded backdrop-blur-sm ${
          filled ? 'bg-emerald-950/70 text-emerald-300' : 'bg-amber-950/70 text-amber-300'
        }`}>
          {filled ? '✓ тексты' : 'нет текстов'}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Открыть опубликованный шорт"
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-950/70 text-red-300 hover:text-red-100 backdrop-blur-sm"
          >
            ▶ youtube
          </a>
        )}
      </div>

      {/* title footer */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pt-8 pb-2.5">
        <div className="text-sm font-semibold leading-tight">{short.title}</div>
        <div className="text-[10px] text-zinc-400 font-mono mt-0.5">{short.slug} · {short.shots} кадров</div>
      </div>
    </div>
  );
}

// ── Editor modal ──────────────────────────────────────────────────────────────

function ShortModal({
  projectId, short, pack, onSaved, onClose,
}: {
  projectId:  string;
  short:      ShortsPlanItem;
  pack:       YoutubeShort | undefined;
  onSaved:    () => void;
  onClose:    () => void;
}) {
  const [title, setTitle] = useState(pack?.title ?? short.title);
  const [desc, setDesc]   = useState(pack?.descBefore ?? '');
  const [tags, setTags]   = useState((pack?.tags ?? []).join(', '));
  const [url, setUrl]     = useState(pack?.url ?? '');
  const [busy, setBusy]   = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState<ShortResult | null>(null);
  const [err, setErr]     = useState<string | null>(null);

  const parseTags = (s: string) => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try {
      await api.patchYoutube(projectId, {
        shorts: { [short.slug]: {
          title: title.trim(), descBefore: desc,
          tags: parseTags(tags), url: url.trim(),
        } },
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const exportOne = async () => {
    setExporting(true); setErr(null); setDraft(null);
    try {
      const r = await api.exportShorts(projectId, { only: short.slug });
      setDraft(r.shorts[0] ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setExporting(false); }
  };

  const del = async () => {
    if (!window.confirm(`Удалить шорт «${short.title}» из плана? Его описания/теги тоже будут удалены.`)) return;
    setBusy(true); setErr(null);
    try {
      await api.deleteShortPlan(projectId, short.slug);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-xl w-full max-h-[90dvh] overflow-y-auto p-5"
      >
        <header className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{short.title}</h2>
            <div className="text-xs text-zinc-500 font-mono">{short.slug} · {short.shots} кадров</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={exportOne}
              disabled={exporting}
              className="text-xs bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"
            >
              {exporting ? '⏳…' : '📱 в CapCut'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-1">✕</button>
          </div>
        </header>

        {/* frame strip: the planned shots, in order */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-1">
          {short.preview.map((p) => (
            <div key={p.shotCode} className="shrink-0 w-12">
              <div className="aspect-[9/16] bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                {p.shotId && p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={api.shotImageUrl(p.shotId, p.image)}
                    alt={p.shotCode}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">—</div>
                )}
              </div>
              <div className="text-[9px] text-zinc-600 font-mono text-center truncate mt-0.5">{p.shotCode}</div>
            </div>
          ))}
        </div>

        {draft && (
          <div className="mt-2 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-2 text-[11px] text-fuchsia-200">
            ✓ {draft.title ?? short.slug} — {draft.shots} кадров, ~{draft.seconds}с
            <code className="block text-fuchsia-100/80 font-mono break-all mt-1">{draft.draft_path ?? draft.draft_name}</code>
          </div>
        )}

        <Row label={`Название шорта ${lim(title.length, 100)}`} value={title}>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm" />
        </Row>

        <Row label={`Описание ${lim(desc.length, 5000)}`} value={desc}>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={6}
            placeholder="Хук + «полная история на канале, подпишись 🔔»"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm leading-relaxed" />
        </Row>

        <Row label={`Теги (${parseTags(tags).length} шт · ${lim(parseTags(tags).join(', ').length, 500)} симв)`} value={parseTags(tags).join(', ')}>
          <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={2}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono" />
        </Row>

        <Row label="Ссылка на опубликованный шорт" value={url}>
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/shorts/…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono" />
          {url.trim() && (
            <a href={url.trim()} target="_blank" rel="noreferrer"
              className="inline-block text-[11px] text-red-300 hover:text-red-100 mt-1">
              ▶ открыть на YouTube
            </a>
          )}
        </Row>

        <ShortUpload projectId={projectId} shortSlug={short.slug} onUploaded={(u) => setUrl(u)} />

        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={busy}
            className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
            {busy ? '…' : 'Сохранить'}
          </button>
          {saved && <span className="text-emerald-400 text-xs">✓ сохранено</span>}
          {err && <span className="text-red-400 text-xs font-mono break-all">{err}</span>}
          <button onClick={del} disabled={busy}
            className="ml-auto text-xs text-red-400 hover:text-red-200 border border-red-900 hover:border-red-700 disabled:opacity-50 px-2.5 py-1.5 rounded">
            🗑 Удалить шорт
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Short → YouTube upload (inside the short editor modal) ──────────────────────
function nextTueThuS(hour = 17): Date {
  const d = new Date(); d.setHours(hour, 0, 0, 0);
  for (let i = 0; i < 14; i++) { const day = d.getDay(); if ((day === 2 || day === 4) && d.getTime() > Date.now()) return d; d.setDate(d.getDate() + 1); }
  return d;
}
function toLocalInputS(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ShortUpload({ projectId, shortSlug, onUploaded }: {
  projectId: string; shortSlug: string; onUploaded: (url: string) => void;
}) {
  const [status, setStatus]       = useState<YoutubeAuthStatus | null>(null);
  const [videoPath, setVideoPath] = useState('');
  const [thumbPath, setThumbPath] = useState('');
  const [synthetic, setSynthetic] = useState(true);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [schedule, setSchedule]   = useState(false);
  const [publishAtLocal, setPublishAtLocal] = useState('');
  const [busy, setBusy]           = useState(false);
  const [result, setResult]       = useState<YoutubeUploadResult | null>(null);
  const [caption, setCaption]     = useState<YoutubeCaptionJob | null>(null);
  const [capBusy, setCapBusy]     = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  useEffect(() => { api.getYoutubeAuthStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => {
    if (!caption || (caption.status !== 'pending' && caption.status !== 'running')) return;
    const t = setTimeout(() => api.getYoutubeCaptions(projectId).then(setCaption).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [caption, projectId]);

  const connected = status?.connected === true;
  const capActive = caption && (caption.status === 'pending' || caption.status === 'running');

  const [picking, setPicking] = useState<'video' | 'image' | null>(null);
  const pick = async (kind: 'video' | 'image', setter: (v: string) => void) => {
    setPicking(kind);
    try { const r = await api.pickYoutubeFile(kind); if (r.path) setter(r.path); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setPicking(null); }
  };

  // Background upload (POST → jobId → poll), same as the main form.
  const pollUpload = async (jobId: string) => {
    let misses = 0;
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      let job: YoutubeUploadJob | null = null;
      try { job = await api.getYoutubeUploadJob(jobId); } catch { if (++misses > 5) break; continue; }
      if (!job) { if (++misses > 5) break; continue; }
      misses = 0;
      if (job.status === 'done')  { setResult(job.result ?? null); if (job.result?.url) onUploaded(job.result.url); setBusy(false); return; }
      if (job.status === 'error') { setErr(job.error ?? 'upload failed'); setBusy(false); return; }
    }
    setErr('заливка не завершилась (нет статуса)'); setBusy(false);
  };

  const upload = async () => {
    if (!videoPath.trim() || !thumbPath.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const { jobId } = await api.uploadYoutubeShort(projectId, shortSlug, {
        videoPath:     videoPath.trim(),
        thumbnailPath: thumbPath.trim(),
        containsSyntheticMedia: synthetic,
        publishAt: schedule && publishAtLocal ? new Date(publishAtLocal).toISOString() : undefined,
        generateCaptions: autoCaptions,
      });
      await pollUpload(jobId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const genCaptions = async () => {
    const videoId = result?.videoId ?? caption?.videoId;
    if (!videoId || !videoPath.trim() || capBusy) return;
    setCapBusy(true); setErr(null);
    try { setCaption(await api.enqueueYoutubeCaptions(projectId, { videoId, videoPath: videoPath.trim() })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setCapBusy(false); }
  };

  return (
    <div className="mt-4 border border-zinc-800 rounded-lg p-3 bg-zinc-950/60">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-300 font-medium">Залить шорт на YouTube (плейлист «шорты»)</span>
        {connected
          ? <span className="text-[11px] text-emerald-400">● {status?.channelTitle}</span>
          : <a href={api.youtubeOAuthUrl()} target="_blank" rel="noreferrer" className="text-[11px] text-red-400 underline">подключить канал</a>}
      </div>

      <div className="flex gap-2 mb-2">
        <input value={videoPath} onChange={(e) => setVideoPath(e.target.value)}
          placeholder="путь к вертикальному mp4 шорта"
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono" />
        <button onClick={() => pick('video', setVideoPath)} disabled={picking === 'video'}
          className="shrink-0 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-2.5 rounded disabled:opacity-50">
          {picking === 'video' ? '…' : '📁'}
        </button>
      </div>
      <div className="flex gap-2 mb-2">
        <input value={thumbPath} onChange={(e) => setThumbPath(e.target.value)}
          placeholder="путь к обложке *обязательно (≤50MB)"
          className={`flex-1 min-w-0 bg-zinc-950 border rounded px-2 py-1.5 text-xs font-mono ${thumbPath.trim() ? 'border-zinc-700' : 'border-red-800'}`} />
        <button onClick={() => pick('image', setThumbPath)} disabled={picking === 'image'}
          className="shrink-0 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-2.5 rounded disabled:opacity-50">
          {picking === 'image' ? '…' : '📁'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
          <input type="checkbox" checked={schedule}
            onChange={async (e) => {
              setSchedule(e.target.checked);
              if (e.target.checked && !publishAtLocal) {
                try { const r = await api.getYoutubeNextSlot('short'); setPublishAtLocal(toLocalInputS(new Date(r.publishAt))); }
                catch { setPublishAtLocal(toLocalInputS(nextTueThuS())); }
              }
            }} />
          вт/чт
        </label>
        {schedule && (
          <input type="datetime-local" value={publishAtLocal} onChange={(e) => setPublishAtLocal(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[11px]" />
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
          <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
          AI-дисклеймер
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300" title="После заливки авто-ставит субтитры в очередь">
          <input type="checkbox" checked={autoCaptions} onChange={(e) => setAutoCaptions(e.target.checked)} />
          субтитры авто
        </label>
        <button onClick={upload} disabled={!connected || !videoPath.trim() || !thumbPath.trim() || busy}
          className="ml-auto text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
          {busy ? '⏳…' : schedule ? '▲ залить + запланировать' : '▲ залить'}
        </button>
      </div>

      {result && (
        <div className="text-[11px] text-zinc-400">
          ✓ <a className="underline text-emerald-300" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
          {' · '}<b>{result.actualPrivacy}</b>
          {result.thumbnailSet
            ? ' · обложка ✓'
            : result.thumbnailError && <span className="text-amber-400"> · ⚠ обложка не встала: {result.thumbnailError}</span>}
          {result.playlistAdded === true && ' · в «шорты» ✓'}
          <button onClick={genCaptions} disabled={capBusy || !!capActive}
            className="ml-2 text-[11px] text-zinc-300 hover:text-white underline disabled:opacity-50">
            {capBusy || capActive ? 'субтитры в очереди…' : '💬 субтитры'}
          </button>
          {caption?.status === 'completed' && caption.uploaded && <span className="text-emerald-400"> ✓ субтитры</span>}
          {caption?.status === 'failed' && <span className="text-red-400"> ✗ {caption.errorMessage}</span>}
        </div>
      )}
      {err && <p className="text-red-400 text-[11px] font-mono break-all mt-1">{err}</p>}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function NewShortModal({
  projectId, onDone, onClose,
}: {
  projectId: string;
  onDone:    () => void;
  onClose:   () => void;
}) {
  const [slug, setSlug]   = useState('');
  const [title, setTitle] = useState('');
  const [shots, setShots] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  const parseShots = (s: string) => s.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.upsertShortPlan(projectId, {
        slug:  slug.trim(),
        title: title.trim(),
        shots: parseShots(shots),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-5 space-y-3"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Новый шорт</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </header>

        <div>
          <label className="text-xs text-zinc-400 uppercase tracking-wider">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))}
            required
            placeholder="hook"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono mt-1"
          />
          <p className="text-[10px] text-zinc-600 mt-0.5">slug существующего шорта — заменит его название и кадры</p>
        </div>

        <div>
          <label className="text-xs text-zinc-400 uppercase tracking-wider">Название</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Серый приговор"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-400 uppercase tracking-wider">
            Кадры ({parseShots(shots).length} шт)
          </label>
          <textarea
            value={shots}
            onChange={(e) => setShots(e.target.value)}
            required
            rows={3}
            placeholder="CO_SH01, CO_SH02, A6_SH03…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono mt-1"
          />
          <p className="text-[10px] text-zinc-600 mt-0.5">
            коды кадров через запятую/пробел, в порядке монтажа; старайся брать анимированные кадры
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={busy}
            className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
            {busy ? '…' : 'Создать'}
          </button>
          {err && <span className="text-red-400 text-xs font-mono break-all">{err}</span>}
        </div>
      </form>
    </div>
  );
}

function Row({
  label, value, hint, children,
}: {
  label: string; value: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400 uppercase tracking-wider">{label}</span>
        <button
          onClick={() => { if (value) navigator.clipboard?.writeText(value).catch(() => {}); }}
          disabled={!value}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-0.5 disabled:opacity-40"
        >
          копировать
        </button>
      </div>
      {children}
      {hint && <p className="text-[10px] text-zinc-600 mt-0.5">{hint}</p>}
    </div>
  );
}

// YouTube hard limits: title 100, description 5000, tags 500 chars total.
function lim(n: number, max: number) {
  return `${n}/${max}${n > max ? ' ⚠ превышен' : ''}`;
}

function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{msg}</div>;
}
