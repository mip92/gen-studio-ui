'use client';

import { useEffect, useState, use } from 'react';
import { api, ShortsPlan, YoutubePackage, YoutubeShort, ShortResult } from '@/lib/api';

// Shorts tab: the list of curated teaser reels. Each row exports just that short
// to a vertical CapCut draft, and carries its YouTube packaging — a BEFORE-publish
// description (teaser) and an AFTER-publish one that links to the main video.
export default function ShortsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [plan, setPlan] = useState<ShortsPlan | null>(null);
  const [pkg,  setPkg]  = useState<YoutubePackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [allResult, setAllResult] = useState<ShortResult[] | null>(null);

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

  return (
    <main className="px-4 sm:px-8 py-6 max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Шорты</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Вертикальные тизеры (9:16) из готовых кадров. Клик по шорту — экспорт этого шорта
            в CapCut. У каждого шорта два описания: <b>до</b> публикации основного видео (тизер)
            и <b>после</b> (со ссылкой на основное). План кадров — в <code>scripts/&lt;slug&gt;_shorts_plan.json</code>.
          </p>
        </div>
        {plan.hasPlan && (
          <button
            onClick={buildAll}
            disabled={busyAll}
            className="text-sm bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-3 py-2 rounded shrink-0"
          >
            {busyAll ? '⏳ собираю…' : `📱 Собрать все (${plan.shorts.length})`}
          </button>
        )}
      </div>

      {error && <div className="mb-4"><Err msg={error} /></div>}
      {allResult && (
        <div className="mb-4 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-3 text-xs text-fuchsia-200">
          ✓ собрано: {allResult.length} шорт(ов) — в списке проектов CapCut.
        </div>
      )}

      {!plan.hasPlan ? (
        <div className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded p-4">
          Плана шортов ещё нет. Создай <code className="text-zinc-400">scripts/&lt;slug&gt;_shorts_plan.json</code> —
          какие кадры входят в каждый шорт (slug, title, shots[]).
        </div>
      ) : (
        <div className="space-y-4">
          {plan.shorts.map((s) => (
            <ShortCard
              key={s.slug}
              projectId={id}
              slug={s.slug}
              planTitle={s.title}
              shots={s.shots}
              youtubeUrl={pkg.youtubeUrl}
              pack={pkg.shorts[s.slug]}
              onSaved={load}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function ShortCard({
  projectId, slug, planTitle, shots, youtubeUrl, pack, onSaved,
}: {
  projectId:  string;
  slug:       string;
  planTitle:  string;
  shots:      number;
  youtubeUrl: string | null;
  pack:       YoutubeShort | undefined;
  onSaved:    () => void;
}) {
  const [title, setTitle] = useState(pack?.title ?? planTitle);
  const [before, setBefore] = useState(pack?.descBefore ?? '');
  const [after, setAfter]   = useState(pack?.descAfter ?? '');
  const [tags, setTags]     = useState((pack?.tags ?? []).join(', '));
  const [busy, setBusy]     = useState(false);
  const [saved, setSaved]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft]   = useState<ShortResult | null>(null);
  const [err, setErr]       = useState<string | null>(null);

  const parseTags = (s: string) => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  // The published main-video link substituted into the "after" description.
  const mainUrl = youtubeUrl || '<ссылка на основное видео>';
  const afterResolved = after.replaceAll('{{main_url}}', mainUrl);

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try {
      await api.patchYoutube(projectId, {
        shorts: { [slug]: { title: title.trim(), descBefore: before, descAfter: after, tags: parseTags(tags) } },
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
      const r = await api.exportShorts(projectId, { only: slug });
      setDraft(r.shorts[0] ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setExporting(false); }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold">{planTitle}</div>
          <div className="text-xs text-zinc-500 font-mono">{slug} · {shots} кадров</div>
        </div>
        <button
          onClick={exportOne}
          disabled={exporting}
          className="text-xs bg-fuchsia-800 hover:bg-fuchsia-700 disabled:opacity-50 text-white px-3 py-1.5 rounded shrink-0"
        >
          {exporting ? '⏳…' : '📱 в CapCut'}
        </button>
      </div>

      {draft && (
        <div className="mb-3 bg-fuchsia-950/40 border border-fuchsia-700 rounded p-2 text-[11px] text-fuchsia-200">
          ✓ {draft.title ?? slug} — {draft.shots} кадров, ~{draft.seconds}с
          <code className="block text-fuchsia-100/80 font-mono break-all mt-1">{draft.draft_path ?? draft.draft_name}</code>
        </div>
      )}

      <Row label={`Название шорта ${lim(title.length, 100)}`} value={title}>
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm" />
      </Row>

      <Row label={`Описание ДО публикации ${lim(before.length, 5000)}`} value={before}>
        <textarea value={before} onChange={(e) => setBefore(e.target.value)} rows={5}
          placeholder="Тизер: короткий хук + «полная история скоро, подпишись 🔔»"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm leading-relaxed" />
      </Row>

      <Row
        label={`Описание ПОСЛЕ публикации ${lim(afterResolved.length, 5000)}`}
        value={afterResolved}
        hint="используй {{main_url}} — подставится ссылка на основное видео"
      >
        <textarea value={after} onChange={(e) => setAfter(e.target.value)} rows={4}
          placeholder="Хук + «▶ Полная история: {{main_url}}» + подпишись 🔔"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm leading-relaxed" />
        {after.includes('{{main_url}}') && (
          <p className={`text-[10px] mt-1 ${youtubeUrl ? 'text-zinc-500' : 'text-amber-400'}`}>
            {youtubeUrl ? `→ ${mainUrl}` : 'основное видео ещё не опубликовано — ссылка появится после'}
          </p>
        )}
      </Row>

      <Row label={`Теги (${parseTags(tags).length} шт · ${lim(parseTags(tags).join(', ').length, 500)} симв)`} value={parseTags(tags).join(', ')}>
        <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono" />
      </Row>

      <div className="flex items-center gap-3 mt-3">
        <button onClick={save} disabled={busy}
          className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
          {busy ? '…' : 'Сохранить'}
        </button>
        {saved && <span className="text-emerald-400 text-xs">✓ сохранено</span>}
        {err && <span className="text-red-400 text-xs font-mono break-all">{err}</span>}
      </div>
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
