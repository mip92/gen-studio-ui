'use client';

import { useEffect, useState, use } from 'react';
import { api, Location } from '@/lib/api';

export default function LocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);

  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<{ slug: string; name: string; description: string }>({ slug: '', name: '', description: '' });
  const [creating, setCreating]   = useState(false);
  const [busy, setBusy]           = useState(false);

  const refresh = async () => {
    try {
      setLoading(true);
      const rows = await api.listLocations(projectId);
      setLocations(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [projectId]);

  const startEdit = (loc: Location) => {
    setEditingId(loc.id);
    setDraft({ slug: loc.slug, name: loc.name, description: loc.description });
    setCreating(false);
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ slug: '', name: '', description: '' });
  };

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({ slug: '', name: '', description: '' });
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (creating) {
        await api.createLocation(projectId, draft);
      } else if (editingId) {
        await api.updateLocation(editingId, draft);
      }
      cancel();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (loc: Location) => {
    if (!confirm(`Удалить локацию "${loc.name}"? Кадры, привязанные к ней, потеряют тег (positive не изменится).`)) return;
    setBusy(true);
    try {
      await api.deleteLocation(loc.id);
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
          <h1 className="text-xl font-semibold">Локации</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Каждая локация — переиспользуемое описание места действия (купе, коридор, тамбур, перрон…).
            Рендерер автоматически подставляет <code className="text-zinc-400">description</code> в начало
            позитивного промпта каждого кадра, привязанного к этой локации. Меняешь описание здесь — обновляется
            у всех кадров с этим тегом.
          </p>
        </div>
        <button
          onClick={startCreate}
          disabled={busy || creating}
          className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded shrink-0"
        >
          + новая локация
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">
          {error}
        </div>
      )}

      {creating && (
        <LocationEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          busy={busy}
          title="Новая локация"
        />
      )}

      {loading ? (
        <div className="text-zinc-500">Загрузка…</div>
      ) : locations.length === 0 && !creating ? (
        <div className="text-zinc-500">
          Локаций ещё нет. Нажми «+ новая локация» чтобы добавить первую.
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <div key={loc.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              {editingId === loc.id ? (
                <LocationEditor
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                  busy={busy}
                  title={`Редактирование: ${loc.name}`}
                />
              ) : (
                <div className="p-4">
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <div>
                      <div className="text-sm font-semibold">{loc.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{loc.slug}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(loc)}
                        disabled={busy}
                        className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-2.5 py-1 rounded"
                      >
                        ✎ редактировать
                      </button>
                      <button
                        onClick={() => remove(loc)}
                        disabled={busy}
                        className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded px-2.5 py-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-950 rounded p-3 border border-zinc-800/50">
                    {loc.description}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function LocationEditor({
  draft, setDraft, onSave, onCancel, busy, title,
}: {
  draft:    { slug: string; name: string; description: string };
  setDraft: (v: { slug: string; name: string; description: string }) => void;
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
          <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">Slug</span>
          <input
            type="text"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            placeholder="train_kupe"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">Название</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Купе советского поезда (4-местное)"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-zinc-400 uppercase tracking-wider mb-1 block">
          Description (английский, идёт в SDXL)
        </span>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="interior of cramped narrow old Soviet long-distance passenger train kupe compartment, very tight space, two single narrow lower berths and two single narrow upper berths bolted to opposite walls (NO double beds, NO wide sleeping surfaces), painted wood-and-frosted-glass sliding door, single small window with a half-drawn fabric curtain, NOT outside, NOT at a platform, NOT in an apartment"
          rows={8}
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
          disabled={busy || !draft.slug.trim() || !draft.name.trim() || !draft.description.trim()}
          className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          {busy ? '…' : 'сохранить'}
        </button>
      </div>
    </div>
  );
}
