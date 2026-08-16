'use client';

import { useEffect, useState, use } from 'react';
import { api, LaunchView, LaunchItemView } from '@/lib/api';
import { YoutubeSubnav } from '@/components/YoutubeSubnav';

// «Связка-запуск» — the FINAL step. Assets (main + shorts) are already uploaded
// Unlisted via their own steppers. Here you: confirm you linked shorts→main in
// Studio (server verifies uploads+subs, not the links) → schedule/publish all.
export default function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<LaunchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  const load = () => api.getLaunch(id).then(setView).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { load(); }, [id]);

  const anyUploadRunning = view?.items.some((i) => i.uploadJobId && !i.videoId && !i.uploadError);
  useEffect(() => {
    if (!anyUploadRunning) return;
    const t = setTimeout(() => api.getLaunch(id).then(setView).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [view, anyUploadRunning, id]);

  if (err && !view) return <main className="px-4 sm:px-8 py-6"><YoutubeSubnav id={id} /><Err msg={err} /></main>;
  if (!view) return <main className="px-4 sm:px-8 py-6"><YoutubeSubnav id={id} /><p className="text-zinc-500">Загрузка…</p></main>;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const doConfirm = () => act(() => api.confirmLaunchLinked(id));
  const doSchedule = () => act(() => api.scheduleLaunch(id));
  const doPublishNow = () => act(() => api.publishLaunchNow(id));

  const main   = view.items.find((i) => i.kind === 'main');
  const shorts = view.items.filter((i) => i.kind === 'short');
  // Subtitles gate on the MAIN video only — a short goes out without an .srt
  // (there is no room for a second text layer in 9:16, and Shorts get YouTube's
  // own auto-captions anyway).
  const ready  = !!main && view.allUploaded && view.subtitlesReady;
  const canPublish = ready && (!view.hasShorts || view.linkedConfirmed);

  return (
    <main className="px-4 sm:px-8 py-6 max-w-3xl">
      <YoutubeSubnav id={id} />
      <h1 className="text-xl font-semibold mb-1">Связка-запуск</h1>
      <p className="text-xs text-zinc-500 mb-5">Финальный шаг. Ассеты грузятся на вкладках «Видео» и «Шорты». Здесь — связывание в Studio и публикация всего вместе.</p>

      {err && <div className="mb-4"><Err msg={err} /></div>}

      {/* Bundle status */}
      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-300 font-medium mb-3">Состав связки</div>
        {!main && <AssetRow label="🎬 Основное видео" href={`/projects/${id}/youtube`} state="—" hint="пройди степпер «Видео»" />}
        {main && <AssetRow label="🎬 Основное видео" href={`/projects/${id}/youtube`} item={main} />}
        {shorts.map((s) => <AssetRow key={s.key} label={`📱 ${s.slug}`} href={`/projects/${id}/youtube/shorts/${s.slug}`} item={s} />)}
        {shorts.length === 0 && <p className="text-[11px] text-zinc-500 mt-2">Шортов нет — опубликуешь основное без связки.</p>}
      </div>

      {view.published ? (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4 text-sm text-emerald-200">
          {view.publishMode === 'public' ? (
            <>✓ Опубликовано{view.hasShorts && ' (всё вместе, связанным)'}. Видео уже в открытом доступе.</>
          ) : (
            <>✓ Запланировано. Основное: <b>{view.mainPublishAt ? new Date(view.mainPublishAt).toLocaleString() : '—'}</b>
              {view.hasShorts && <>, шорты: <b>{view.shortsPublishAt ? new Date(view.shortsPublishAt).toLocaleString() : '—'}</b></>}.
              <div className="text-[11px] text-emerald-300/80 mt-1">Всё выйдет в своё время{view.hasShorts && ', связанным'}. Готово.</div></>
          )}
        </div>
      ) : !ready ? (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
          Не всё готово к публикации. Заверши степперы (заливка Unlisted + субтитры) для всех ассетов выше, потом возвращайся сюда.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Linking (shorts only) */}
          {view.hasShorts && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
              <div className="text-sm font-medium text-zinc-200 mb-2">Связывание в Studio {view.linkedConfirmed && <span className="text-emerald-400 text-xs">✓ подтверждено</span>}</div>
              <p className="text-xs text-zinc-400 mb-2">
                В каждом шорте (Studio) → <b>Видео по теме</b> → вставь ID основного → Сохрани.
                {main?.videoId && <> ID: <code className="text-emerald-300">{main.videoId}</code>
                  <button onClick={() => navigator.clipboard?.writeText(main.videoId ?? '')} className="ml-1 text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-1.5">копир.</button></>}
              </p>
              {shorts.map((s) => (
                <a key={s.key} href={`https://studio.youtube.com/video/${s.videoId}/edit`} target="_blank" rel="noreferrer"
                  className="block text-[11px] text-blue-400 hover:underline">📱 {s.slug} — открыть в Studio ↗</a>
              ))}
              {!view.linkedConfirmed && (
                <button onClick={doConfirm} disabled={busy} className="mt-3 text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded">
                  {busy ? '…' : '🔗 Я связал всё, продолжить →'}
                </button>
              )}
              <p className="mt-1.5 text-[11px] text-zinc-600">Факт связывания API не отдаёт — на доверии. Сервер проверяет только заливку и субтитры.</p>
            </div>
          )}

          {/* Publish */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <div className="text-sm font-medium text-zinc-200 mb-2">Публикация</div>
            {!canPublish ? (
              <p className="text-xs text-amber-300">Сначала подтверди связывание выше.</p>
            ) : (
              <>
                <SlotNote view={view} />
                <div className="flex items-center gap-3">
                  <button onClick={doSchedule} disabled={busy || view.plannedReleasePast}
                    title={view.plannedReleasePast ? 'Дата в календаре уже прошла — подвинь слот' : undefined}
                    className="text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded">
                    {busy ? '…' : view.plannedReleaseAt ? '📅 Запланировать на дату календаря' : '📅 Запланировать вт/чт'}
                  </button>
                  <button onClick={doPublishNow} disabled={busy} className="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 text-white px-4 py-2 rounded">
                    Опубликовать сейчас
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Что именно уйдёт в publishAt. Дата берётся из релизного календаря
 * (Project.releaseAt) — «ближайший свободный вт/чт» остался только запасным
 * путём для фильма, которого в календаре нет.
 */
function SlotNote({ view }: { view: LaunchView }) {
  if (!view.plannedReleaseAt) {
    return (
      <p className="text-xs text-amber-300 mb-3">
        В <a href="/releases" className="underline hover:text-amber-200">календаре релизов</a> у этого фильма нет даты —
        встанет ближайший вт/чт 16:00{view.hasShorts && ', шорты +5 минут'}. Лучше сначала назначить слот.
      </p>
    );
  }
  const at = new Date(view.plannedReleaseAt);
  const when = at.toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (view.plannedReleasePast) {
    return (
      <p className="text-xs text-red-300 mb-3">
        Дата в <a href="/releases" className="underline hover:text-red-200">календаре</a> ({when}) уже прошла — подвинь слот
        или публикуй сейчас.
      </p>
    );
  }
  return (
    <p className="text-xs text-zinc-500 mb-3">
      Основное — по <a href="/releases" className="underline hover:text-zinc-300">календарю</a>:{' '}
      <b className="text-zinc-300">{when}</b>{view.hasShorts && ', шорты — +5 минут'}. Или опубликовать сейчас.
    </p>
  );
}

function AssetRow({ label, href, item, state, hint }: {
  label: string; href: string; item?: LaunchItemView; state?: string; hint?: string;
}) {
  const st = item
    ? (item.uploaded ? (item.thumbnailMissing ? '✓ залито · ⚠ без обложки' : '✓ залито (Unlisted)')
        : item.uploadError ? `✗ ${item.uploadError}` : item.uploadJobId ? '⏳ заливаю…'
        : item.transcribeStatus === 'completed' ? 'субтитры ✓ — залей' : item.transcribeStatus ? '⏳ субтитры…'
        // A short has no subtitle step to wait for, so «—» would read as "not ready".
        : item.kind === 'short' ? 'готов к заливке (субтитры не нужны)' : '—')
    : (state ?? '—');
  const color = item?.uploadError ? 'text-red-400'
    : item?.uploaded ? (item.thumbnailMissing ? 'text-amber-400' : 'text-emerald-400') : 'text-zinc-400';
  return (
    // flex-wrap + break-words: uploadError — произвольная строка YouTube API;
    // с shrink-0 она не переносилась и обрезалась краем экрана на телефоне
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-zinc-800 rounded px-3 py-2 mb-1.5 text-sm">
      <a href={href} className="text-zinc-300 hover:text-blue-300 truncate">{label}</a>
      <span className={`text-xs break-words min-w-0 ${color}`}>{st}{hint && !item && <span className="text-zinc-600"> · {hint}</span>}</span>
    </div>
  );
}
function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap break-all">{msg}</div>;
}
