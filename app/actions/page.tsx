'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { api, ActionItem, ActionGateKey, ProjectListItem } from '../../lib/api';

const GATE_LABELS: Record<ActionGateKey, { num: number; ru: string }> = {
  upload_dataset_images: { num: 1,  ru: 'Загрузить изображения' },
  start_dataset:         { num: 2,  ru: 'Запустить датасет' },
  start_training:        { num: 3,  ru: 'Запустить тренировку LoRA' },
  // Cartoon projects use only this gate for character setup. Slots into the
  // same "phase 1" zone as the photoreal upload/dataset gates above.
  generate_anchor:       { num: 1,  ru: 'Сгенерировать anchor (cartoon)' },
  render_scene:          { num: 4,  ru: 'Сгенерировать сцену' },
  approve_render:        { num: 5,  ru: 'Утвердить рендер' },
  create_video:          { num: 6,  ru: 'Создать видео' },
  approve_video:         { num: 7,  ru: 'Утвердить видео' },
  upscale_video:         { num: 8,  ru: 'Апскейл видео' },
  interpolate_video:     { num: 9,  ru: 'Увеличить FPS (обязательно)' },
  render_tts:            { num: 10, ru: 'Озвучить — нет голоса' },
  approve_tts:           { num: 11, ru: 'Утвердить закадровый голос' },
  approve_bgm:           { num: 12, ru: 'Утвердить фоновую музыку' },
};

// Gate order on the page — characters first (anchor for cartoon OR 1-3 for
// photoreal), shots second (4-9), BGM last (10).
const GATE_ORDER: ActionGateKey[] = [
  'generate_anchor',
  'upload_dataset_images',
  'start_dataset',
  'start_training',
  'render_scene',
  'approve_render',
  'create_video',
  'approve_video',
  'upscale_video',
  'interpolate_video',
  'render_tts',
  'approve_tts',
  'approve_bgm',
];

const POLL_MS = 10_000;

export default function ActionsPage() {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectSlug, setProjectSlug] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await api.listActions(projectSlug || undefined);
        if (!cancelled) {
          setItems(res.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e instanceof Error ? e.message : e));
        }
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectSlug]);

  // Group items by project, then by gate, preserving the canonical gate order.
  const grouped = useMemo(() => {
    const byProject = new Map<string, { project: ActionItem['project']; gates: Map<ActionGateKey, ActionItem[]> }>();
    for (const item of items ?? []) {
      let entry = byProject.get(item.project.id);
      if (!entry) {
        entry = { project: item.project, gates: new Map() };
        byProject.set(item.project.id, entry);
      }
      const list = entry.gates.get(item.gateKey) ?? [];
      list.push(item);
      entry.gates.set(item.gateKey, list);
    }
    return Array.from(byProject.values()).sort((a, b) => a.project.name.localeCompare(b.project.name));
  }, [items]);

  const handleRun = async (item: ActionItem, key: string) => {
    if (!item.action) return;
    setRunningId(key);
    try {
      await api.runAction(item.action);
      // Optimistic: re-fetch immediately so the row disappears once the next
      // gate kicks in.
      const res = await api.listActions(projectSlug || undefined);
      setItems(res.items);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-full">
      <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-3 pb-3">
          <Breadcrumbs items={[{ label: 'Overview', href: '/' }, { label: 'Действия' }]} />
          <div className="flex items-baseline gap-4 mt-1">
            <h1 className="text-xl font-semibold text-zinc-100">Действия</h1>
            <span className="text-sm text-zinc-500">
              {items === null ? '…' : `${items.length} ожидают`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs uppercase tracking-wider text-zinc-500">Проект:</label>
              <select
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded px-2 py-1"
              >
                <option value="">Все</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.slug}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <main className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8">
        {error && (
          <div className="rounded border border-red-900 bg-red-950 text-red-200 text-sm px-4 py-3">
            <div className="font-semibold mb-1">Не удалось загрузить /actions</div>
            <div className="font-mono text-xs whitespace-pre-wrap">{error}</div>
            <div className="text-xs text-red-300 mt-2">
              Если 404 — бэкенд ещё не перезапущен после добавления ActionsModule. После тренировки LoRA сделай рестарт: <code className="bg-black/30 px-1 rounded">npm start</code> в gen-studio.
            </div>
          </div>
        )}

        {items !== null && items.length === 0 && !error && (
          <div className="text-sm text-zinc-500 text-center py-16">
            Нет задач, ожидающих действий. Всё в работе или в очереди.
          </div>
        )}

        {grouped.map(({ project, gates }) => (
          <section key={project.id} className="space-y-4">
            <div className="border-b border-zinc-800 pb-1">
              <Link
                href={`/projects/${project.id}`}
                className="text-lg font-semibold text-zinc-100 hover:text-zinc-300"
              >
                {project.name}
              </Link>
              <span className="ml-3 text-xs text-zinc-500">{project.slug}</span>
            </div>

            {GATE_ORDER.filter((k) => gates.has(k)).map((gateKey) => {
              const list  = gates.get(gateKey)!;
              const label = GATE_LABELS[gateKey];
              return (
                <div key={gateKey} className="rounded border border-zinc-800 bg-zinc-900/50">
                  <div className="px-4 py-2 border-b border-zinc-800 flex items-baseline gap-2">
                    <span className="text-xs font-mono text-zinc-500">#{label.num}</span>
                    <span className="text-sm font-medium text-zinc-200">{label.ru}</span>
                    <span className="ml-auto text-xs text-zinc-500">{list.length}</span>
                  </div>
                  <ul className="divide-y divide-zinc-800">
                    {list.map((item) => {
                      const key = `${item.gateKey}-${item.profile?.id ?? item.shot?.id ?? item.segment?.id ?? item.scene?.id}`;
                      return (
                        <li key={key} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                          <span className="flex-1 min-w-0 truncate text-zinc-200">
                            <Target item={item} />
                          </span>
                          <Link
                            href={item.link}
                            className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                          >
                            Открыть
                          </Link>
                          {item.action && (
                            <button
                              onClick={() => handleRun(item, key)}
                              disabled={runningId === key}
                              className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs disabled:opacity-50 disabled:cursor-wait"
                            >
                              {runningId === key ? '…' : 'Запустить'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}

/** Render the human-readable target label for a row, depending on whether the
 *  gate is character-scoped (1-3), shot-scoped (4-9), segment-scoped (10 BGM),
 *  or the rarer scene-only case (gate 9 legacy scene-VO). */
function Target({ item }: { item: ActionItem }) {
  if (item.character && item.profile) {
    const name = item.character.displayName || item.character.code;
    return (
      <>
        <span className="font-medium">{name}</span>
        <span className="text-zinc-500"> · {item.profile.code}</span>
      </>
    );
  }
  if (item.shot) {
    const sceneLabel = item.scene?.title || item.scene?.sceneKey || '';
    return (
      <>
        <span className="font-medium">{item.shot.code}</span>
        {sceneLabel && <span className="text-zinc-500"> · {sceneLabel}</span>}
      </>
    );
  }
  if (item.segment) {
    const blockLabel = item.segment.block.title || item.segment.block.slug;
    return (
      <>
        <span className="font-medium">{blockLabel} · сегмент {item.segment.sortOrder + 1}</span>
        <span className="text-zinc-500"> · {item.segment.durationSec}s</span>
      </>
    );
  }
  if (item.scene) {
    return (
      <>
        <span className="font-medium">{item.scene.title || item.scene.sceneKey}</span>
        <span className="text-zinc-500"> · сцена</span>
      </>
    );
  }
  return <span className="text-zinc-500">—</span>;
}
