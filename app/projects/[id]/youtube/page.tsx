'use client';

import { useEffect, useState, use } from 'react';
import { api, YoutubePackage } from '@/lib/api';

// Main-video YouTube tab: title / description / tags for the full film, plus the
// CapCut export of the full film. Packaging is stored in Project.settings.youtube
// and edited here; the export reuses the existing capcut endpoint.
export default function YoutubePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [pkg,   setPkg]   = useState<YoutubePackage | null>(null);
  const [title, setTitle] = useState('');
  const [desc,  setDesc]  = useState('');
  const [tags,  setTags]  = useState('');   // comma/newline separated
  const [busy,  setBusy]  = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getYoutube(id).then((p) => {
      setPkg(p);
      setTitle(p.main.title);
      setDesc(p.main.description);
      setTags((p.main.tags ?? []).join(', '));
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const parseTags = (s: string) =>
    s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const p = await api.patchYoutube(id, {
        main: { title: title.trim(), description: desc, tags: parseTags(tags) },
      });
      setPkg(p);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !pkg) return <main className="px-4 sm:px-8 py-6"><Err msg={error} /></main>;
  if (!pkg)          return <main className="px-4 sm:px-8 py-6"><p className="text-zinc-500">Загрузка…</p></main>;

  return (
    <main className="px-4 sm:px-8 py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">YouTube — основное видео</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Упаковка полного видео: название, описание, теги. Плюс сборка CapCut-драфта всего фильма.
          {pkg.youtubeUrl
            ? <> Опубликовано: <a className="text-blue-400 hover:underline" href={pkg.youtubeUrl} target="_blank" rel="noreferrer">{pkg.youtubeUrl}</a>.</>
            : <> Ещё не опубликовано (ссылка задаётся на вкладке Overview).</>}
        </p>
      </div>

      {error && <div className="mb-4"><Err msg={error} /></div>}

      <ExportFullButton projectId={id} />

      <Field label="Название видео" value={title} onCopy={() => copy(title)}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ТЫ — <РОЛЬ> (И ЭТО ВСЯ ТВОЯ ЖИЗНЬ)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm"
        />
      </Field>

      <Field label={`Описание (${desc.length})`} value={desc} onCopy={() => copy(desc)}>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={12}
          placeholder="RU, 2-е лицо, эмодзи по битам, хук → ставка → CTA → дисклеймер…"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm leading-relaxed whitespace-pre-wrap"
        />
      </Field>

      <Field
        label={`Теги (${parseTags(tags).length})`}
        value={parseTags(tags).join(', ')}
        onCopy={() => copy(parseTags(tags).join(', '))}
      >
        <textarea
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          rows={4}
          placeholder="и это вся твоя жизнь, поучительная история, … (через запятую)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed"
        />
      </Field>

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={save}
          disabled={busy}
          className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded"
        >
          {busy ? '…' : 'Сохранить'}
        </button>
        {saved && <span className="text-emerald-400 text-sm">✓ сохранено</span>}
      </div>
    </main>
  );
}

// Compact full-film CapCut export (mirrors the Overview button, standalone here).
function ExportFullButton({ projectId }: { projectId: string }) {
  const [busy,   setBusy]   = useState(false);
  const [ready,  setReady]  = useState<boolean | null>(null);
  const [missing, setMissing] = useState(0);
  const [result, setResult] = useState<{ draftPath: string; sceneCount: number; shotCount: number } | null>(null);
  const [err,    setErr]    = useState<string | null>(null);

  useEffect(() => {
    api.capcutReadiness(projectId)
      .then((r) => { setReady(r.ready); setMissing(r.missingShots.length + r.missingScenes.length); })
      .catch(() => setReady(null));
  }, [projectId]);

  const onClick = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await api.exportCapcut(projectId)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-300">Экспорт полного видео в CapCut (16:9)</div>
        <button
          onClick={onClick}
          disabled={!ready || busy}
          title={ready ? 'Собрать draft для CapCut' : ready === null ? 'Проверяю…' : `Не готово: ${missing} пункт(ов)`}
          className={`text-sm font-medium border rounded px-4 py-2 transition-colors ${ready
            ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-white'
            : 'bg-zinc-950 border-zinc-700 text-zinc-500 cursor-not-allowed'}`}
        >
          {busy ? '⏳ собираю…' : ready === false ? `🎬 не готово (${missing})` : '🎬 Экспорт в CapCut'}
        </button>
      </div>
      {err && <p className="mt-2 text-red-400 text-xs font-mono whitespace-pre-wrap break-all">{err}</p>}
      {result && (
        <div className="mt-3 bg-emerald-950/40 border border-emerald-700 rounded p-3 text-xs">
          <p className="text-emerald-300">✓ draft — {result.sceneCount} сцен, {result.shotCount} кадров</p>
          <code className="block text-emerald-200 font-mono break-all bg-black/30 p-1.5 rounded text-[10px] mt-1">{result.draftPath}</code>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onCopy, children,
}: {
  label: string; value: string; onCopy: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400 uppercase tracking-wider">{label}</span>
        <button
          onClick={onCopy}
          disabled={!value}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-0.5 disabled:opacity-40"
        >
          копировать
        </button>
      </div>
      {children}
    </div>
  );
}

function copy(text: string) {
  if (text) navigator.clipboard?.writeText(text).catch(() => {});
}

function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{msg}</div>;
}
