'use client';

import { useCallback, useState, use } from 'react';
import { api, Prop } from '@/lib/api';
import { PropAnchorPanel } from '@/components/PropAnchorPanel';
import { RefreshControl } from '@/components/RefreshControl';
import { useLiveEvents, on } from '@/lib/liveEvents';
import { useRefreshable } from '@/lib/useRefreshable';

export default function PropsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);

  const [props, setProps]         = useState<Prop[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<{ code: string; name: string; description: string }>({ code: '', name: '', description: '' });
  const [creating, setCreating]   = useState(false);
  const [busy, setBusy]           = useState(false);

  /** `silent` skips the loading state: the anchor panel refetches the list after
   *  every queue/select/delete, and flipping the whole page back to «Загрузка…»
   *  on each of those read as a page reload. */
  const refresh = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const rows = await api.listProps(projectId);
      setProps(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  const refreshSilent = () => refresh({ silent: true });

  // No timer anywhere on this page. The prop list itself only changes when the
  // user edits it or a prop_anchor render lands, both of which are events.
  const loadProps = useCallback(async () => { await refresh({ silent: true }); }, [projectId]);
  const { refreshing, lastUpdatedAt, refresh: reloadProps } = useRefreshable(loadProps);
  const match = useCallback(on.all(on.project(projectId), on.types('prop_anchor')), [projectId]);
  const streamStatus = useLiveEvents(match, reloadProps, { active: false });

  const startEdit = (p: Prop) => {
    setEditingId(p.id);
    setDraft({ code: p.code, name: p.name, description: p.description });
    setCreating(false);
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ code: '', name: '', description: '' });
  };

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({ code: '', name: '', description: '' });
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (creating) {
        await api.createProp(projectId, draft);
      } else if (editingId) {
        await api.updateProp(editingId, draft);
      }
      cancel();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Prop) => {
    if (!confirm(`Удалить предмет "${p.name}"? Кадры, привязанные к нему, потеряют тег.`)) return;
    setBusy(true);
    try {
      await api.deleteProp(p.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="px-4 sm:px-8 py-6">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Предметы</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Предметы — отдельная сущность, не персонажи, но возможности те же: описание
            (как <code className="text-zinc-400">promptBase</code>), сгенерированный якорь, галерея кандидатов,
            ручной выбор, свой движок. Без якоря предмет доезжает до модели одним текстом, а текст
            не держит форму — та же швейная машинка в каждом кадре получается другой. С якорем
            рендерер прикладывает его отдельной картинкой и требует сохранить объект целиком:
            ту же форму и цвет. Разница с людьми одна: у человека якорь отвечает только за лицо и
            волосы, у предмета — за весь объект. Описание — английский.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* ONE control for the page. The per-prop panels below deliberately
              have none: a dozen «данные от HH:MM» lines is noise, and they all
              re-read off the same project-scoped delta anyway. */}
          <RefreshControl
            lastUpdatedAt={lastUpdatedAt}
            refreshing={refreshing}
            onRefresh={reloadProps}
            live={streamStatus === 'open'}
          />
          <button
            onClick={startCreate}
            disabled={busy || creating}
            className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded"
          >
            + новый предмет
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">
          {error}
        </div>
      )}

      {creating && (
        <PropEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          busy={busy}
          title="Новый предмет"
        />
      )}

      {loading ? (
        <div className="text-zinc-500">Загрузка…</div>
      ) : props.length === 0 && !creating ? (
        <div className="text-zinc-500">
          Предметов ещё нет. Нажми «+ новый предмет» чтобы добавить первый якорь на объект.
        </div>
      ) : (
        <div className="space-y-3">
          {props.map((p) => (
            <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              {editingId === p.id ? (
                <PropEditor
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                  busy={busy}
                  title={`Редактирование: ${p.name}`}
                />
              ) : (
                <div className="p-4">
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <div>
                      <div className="text-sm font-semibold">{p.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{p.code}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        disabled={busy}
                        className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-2.5 py-1 rounded"
                      >
                        ✎ редактировать
                      </button>
                      <button
                        onClick={() => remove(p)}
                        disabled={busy}
                        className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded px-2.5 py-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-950 rounded p-3 border border-zinc-800/50">
                    {p.description}
                  </div>
                  <PropAnchorPanel prop={p} onChanged={refreshSilent} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function PropEditor({
  draft, setDraft, onSave, onCancel, busy, title,
}: {
  draft:    { code: string; name: string; description: string };
  setDraft: (v: { code: string; name: string; description: string }) => void;
  onSave:   () => void;
  onCancel: () => void;
  busy:     boolean;
  title:    string;
}) {
  return (
    <div className="p-4 bg-zinc-900/70 border border-zinc-700 rounded-lg space-y-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{title}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">Code</span>
          <input
            type="text"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            placeholder="brass_token"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">Название</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Латунный номерок"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">
          Описание предмета (английский, идёт в SDXL)
        </span>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="a single worn brass numbered cloakroom token, a small round burnished brass disc with a stamped number and a hole, polished smooth by decades of handling, hanging on a loop of string"
          rows={6}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed"
        />
      </label>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5"
        >
          отмена
        </button>
        <button
          onClick={onSave}
          disabled={busy || !draft.code.trim() || !draft.name.trim() || !draft.description.trim()}
          className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          {busy ? '…' : 'сохранить'}
        </button>
      </div>
    </div>
  );
}
