'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type Voiceover, type ProjectListItem } from '../lib/api';
import { Breadcrumbs } from './Breadcrumbs';

/**
 * Detail / editor for one library voice. Shows the clip preview, lets you edit
 * its label / slug / source link, and manage WHICH projects use it (bidirectional
 * assign — the project-side picker lives in ProjectTTSSettings). Because a project
 * can hold only one voice (Project.ttsVoiceoverId), assigning a project here that
 * already uses another voice reassigns it; that's flagged inline.
 */
export function VoiceoverDetail({ id }: { id: string }) {
  const router = useRouter();

  const [voice, setVoice]       = useState<Voiceover | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  /** projectId → the voice that currently owns it (to flag reassignment). */
  const [ownerByProject, setOwnerByProject] = useState<Map<string, { id: string; name: string }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy]   = useState<string | null>(null);

  // Editable metadata.
  const [name, setName]   = useState('');
  const [slug, setSlug]   = useState('');
  const [url, setUrl]     = useState('');

  // Project assignment selection (set of projectIds assigned to THIS voice).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setError(null);
    const [v, projs, allVoices] = await Promise.all([
      api.getVoiceover(id),
      api.listProjects(),
      api.listVoiceovers(),
    ]);
    setVoice(v);
    setName(v.name);
    setSlug(v.slug);
    setUrl(v.sourceUrl ?? '');
    setSelected(new Set(v.projects.map((p) => p.id)));
    setProjects(projs);
    const owner = new Map<string, { id: string; name: string }>();
    for (const ov of allVoices) {
      for (const p of ov.projects) owner.set(p.id, { id: ov.id, name: ov.name });
    }
    setOwnerByProject(owner);
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const metaDirty = useMemo(
    () => !!voice && (name.trim() !== voice.name || slug.trim() !== voice.slug || url.trim() !== (voice.sourceUrl ?? '')),
    [voice, name, slug, url],
  );

  const assignDirty = useMemo(() => {
    if (!voice) return false;
    const cur = new Set(voice.projects.map((p) => p.id));
    if (cur.size !== selected.size) return true;
    for (const x of selected) if (!cur.has(x)) return true;
    return false;
  }, [voice, selected]);

  const saveMeta = async () => {
    setBusy('meta'); setError(null);
    try {
      const updated = await api.renameVoiceover(id, {
        name: name.trim(),
        slug: slug.trim(),
        sourceUrl: url.trim(), // '' clears the link
      });
      setVoice((prev) => (prev ? { ...prev, ...updated } : updated));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (projectId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const saveAssignments = async () => {
    setBusy('assign'); setError(null);
    try {
      await api.setVoiceoverProjects(id, [...selected]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    const n = voice?.projects.length ?? 0;
    const msg = n > 0
      ? `Удалить голос «${voice?.name}»? Он назначен ${n} проекту(ам) — они будут отвязаны. Файл на диске будет удалён.`
      : `Удалить голос «${voice?.name}»? Файл на диске будет удалён.`;
    if (!confirm(msg)) return;
    setBusy('delete'); setError(null);
    try {
      await api.deleteVoiceover(id, n > 0);
      router.push('/voices');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 sm:px-8 py-4">
        <div className="max-w-5xl mx-auto">
          <Breadcrumbs items={[
            { label: 'Overview', href: '/' },
            { label: 'Озвучка', href: '/voices' },
            { label: voice?.name ?? '…' },
          ]} />
          <h1 className="text-xl font-semibold">{voice?.name ?? 'Загрузка…'}</h1>
          {voice && <p className="text-xs text-zinc-500 font-mono mt-1">{voice.slug} · {voice.ext.replace('.', '')}</p>}
        </div>
      </header>

      <main className="p-4 sm:p-8 max-w-5xl mx-auto space-y-8">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}

        {!voice && !error && <p className="text-zinc-500">Loading…</p>}

        {voice && (
          <>
            {/* Preview + metadata */}
            <section className="space-y-4">
              <audio key={voice.id} controls preload="none" src={api.voiceoverRawUrl(voice.id)} className="h-9 w-full max-w-md" />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                <Field label="Имя">
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full" />
                </Field>
                <Field label="Slug (папка на диске)">
                  <input value={slug} onChange={(e) => setSlug(e.target.value)}
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full font-mono" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Ссылка-источник (YouTube и т.п.)">
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…"
                      className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full font-mono" />
                  </Field>
                  {voice.sourceUrl && (
                    <a href={voice.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-xs underline mt-1 inline-block break-all">
                      ↗ открыть текущий источник
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={saveMeta} disabled={!metaDirty || busy === 'meta'}
                  className={`text-sm px-4 py-2 rounded ${
                    metaDirty && busy !== 'meta'
                      ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}>
                  {busy === 'meta' ? 'Сохранение…' : 'Сохранить'}
                </button>
                <code className="text-[11px] text-zinc-600 font-mono truncate">{voice.filePath}</code>
              </div>
            </section>

            {/* Project assignments */}
            <section className="space-y-3">
              <div>
                <h2 className="text-sm uppercase tracking-wider text-zinc-400">Проекты с этим голосом</h2>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Отметь проекты, которым назначен этот голос. У проекта может быть только один голос —
                  если он сейчас на другом голосе, он будет переназначен.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-w-2xl">
                {projects.map((p) => {
                  const owner = ownerByProject.get(p.id);
                  const checked = selected.has(p.id);
                  const stealsFrom = !checked && owner && owner.id !== voice.id ? owner.name : null;
                  return (
                    <label key={p.id}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer text-sm ${
                        checked ? 'bg-emerald-900/30 border-emerald-800' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                      }`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} className="accent-emerald-600" />
                      <span className="flex-1 truncate">{p.name}</span>
                      {stealsFrom && (
                        <span className="text-[10px] text-amber-500/80 shrink-0" title={`Сейчас: ${stealsFrom}`}>
                          ← {stealsFrom}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <button onClick={saveAssignments} disabled={!assignDirty || busy === 'assign'}
                className={`text-sm px-4 py-2 rounded ${
                  assignDirty && busy !== 'assign'
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}>
                {busy === 'assign' ? 'Сохранение…' : 'Сохранить назначения'}
              </button>
            </section>

            {/* Danger zone */}
            <section className="border-t border-zinc-900 pt-5">
              <button onClick={onDelete} disabled={busy === 'delete'}
                className="text-sm text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-3 py-1.5 rounded disabled:opacity-50">
                {busy === 'delete' ? 'Удаление…' : 'Удалить голос из библиотеки'}
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
