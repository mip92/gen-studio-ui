'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type Voiceover } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';

/**
 * Озвучка — the shared voice library ("voice actors"). One table listing every
 * reusable voice-clone clip, the projects each is assigned to, its source link
 * and an inline preview. A voice lives ONCE on disk (data/_voices/<slug>/) and
 * is referenced by many projects, so renaming / re-sourcing / re-assigning here
 * is the single source of truth. Click a row to open its detail page.
 */
export default function VoicesPage() {
  const [voices, setVoices]   = useState<Voiceover[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl]   = useState('');
  const fileRef               = useRef<HTMLInputElement>(null);

  const reload = () =>
    api.listVoiceovers()
      .then(setVoices)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => { reload(); }, []);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      await api.createVoiceover(file, {
        name:      newName.trim() || undefined,
        sourceUrl: newUrl.trim()  || undefined,
      });
      setNewName(''); setNewUrl('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto">
          <Breadcrumbs items={[{ label: 'Overview', href: '/' }, { label: 'Озвучка' }]} />
          <h1 className="text-xl font-semibold">Озвучка — актёры</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
            Общая библиотека голосов для voice-clone движков (XTTS-v2 / F5). Один голос хранится
            один раз в <code className="text-zinc-600">data/_voices/&lt;slug&gt;/</code> и назначается
            любому числу проектов. Загруженные файлы с одинаковым содержимым склеиваются по md5.
          </p>
        </div>
      </header>

      <main className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* Add a new voice to the library */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Имя (необязательно)</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="напр. Захар (мужской, низкий)"
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-64"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[16rem]">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Ссылка-источник (YouTube, необязательно)</label>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full font-mono"
            />
          </div>
          <label className={`text-sm px-4 py-2 rounded cursor-pointer self-end ${
            busy ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-emerald-700 hover:bg-emerald-600 text-white'
          }`}>
            {busy ? 'Загрузка…' : '⬆ Добавить голос'}
            <input ref={fileRef} type="file" accept="audio/*" hidden disabled={busy}
              onChange={(e) => onUpload(e.target.files?.[0])} />
          </label>
        </div>

        {!voices && !error && <p className="text-zinc-500">Loading…</p>}
        {voices && voices.length === 0 && (
          <p className="text-zinc-500">Библиотека пуста — добавь первый голос выше.</p>
        )}

        {voices && voices.length > 0 && (
          <div className="overflow-x-auto border border-zinc-800 rounded-lg">
            <table className="w-full text-sm min-w-[56rem]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  <th className="px-4 py-2.5 font-medium">Голос</th>
                  <th className="px-4 py-2.5 font-medium">Превью</th>
                  <th className="px-4 py-2.5 font-medium">Проекты</th>
                  <th className="px-4 py-2.5 font-medium">Источник</th>
                  <th className="px-4 py-2.5 font-medium text-right">Файл</th>
                </tr>
              </thead>
              <tbody>
                {voices.map((v) => (
                  <tr key={v.id} className="border-b border-zinc-900 hover:bg-zinc-900/50 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/voices/${v.id}`} className="font-medium text-zinc-100 hover:text-blue-400">
                        {v.name}
                      </Link>
                      <div className="text-[11px] text-zinc-600 font-mono">{v.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <audio controls preload="none" src={api.voiceoverRawUrl(v.id)} className="h-8 max-w-[14rem]" />
                    </td>
                    <td className="px-4 py-3">
                      {v.projects.length === 0 ? (
                        <span className="text-zinc-600 italic text-xs">не назначен</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {v.projects.map((p) => (
                            <Link
                              key={p.id}
                              href={`/projects/${p.id}`}
                              className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-blue-700 hover:text-blue-300"
                            >
                              {p.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.sourceUrl ? (
                        <a
                          href={v.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-xs underline break-all"
                          title={v.sourceUrl}
                        >
                          ↗ ссылка
                        </a>
                      ) : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-[11px] font-mono text-zinc-500 uppercase">{v.ext.replace('.', '')}</span>
                      <div className="text-[11px] text-zinc-600">{formatBytes(v.bytes)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
