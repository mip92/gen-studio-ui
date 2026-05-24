'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Location, ShotPromptFields, UpdateShotBody } from '../lib/api';
import { useShotCtx } from './ShotPageShell';
import { Field, Value, Input, Textarea } from './ShotDetail';

export function ShotPromptsTab() {
  const { shot, setShot, projectId, shotId } = useShotCtx();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<UpdateShotBody>({});
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [locations, setLocations]       = useState<Location[]>([]);
  const [savingLocation, setSavingLoc]  = useState(false);

  // Load project locations once — they're reused across all shots.
  useEffect(() => {
    api.listLocations(projectId).then(setLocations).catch(() => {});
  }, [projectId]);

  const pf  = shot.promptFields ?? {};
  const dpf = (draft.promptFields ?? pf) as ShotPromptFields;
  const currentLocation = locations.find((l) => l.id === shot.locationId) ?? null;

  const startEdit = () => {
    setDraft({
      shotCode:         shot.shotCode,
      promptFields:     { ...pf },
      workflowRouteKey: shot.workflowRouteKey ?? undefined,
    });
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setDraft({}); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // Don't pass participants — that's the Participants tab's territory.
      const { participants: _drop, ...patch } = draft;
      void _drop;
      const updated = await api.updateShot(shotId, patch);
      setShot(updated);
      setEditing(false);
      setDraft({});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Удалить кадр ${shot.shotCode}?`)) return;
    setBusy(true);
    try {
      await api.deleteShot(shotId);
      router.push(`/projects/${projectId}/scenes#${shot.scene?.sceneKey ?? ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const updatePf = (patch: Partial<ShotPromptFields>) => {
    setDraft((d) => ({ ...d, promptFields: { ...((d.promptFields ?? pf) as ShotPromptFields), ...patch } }));
  };

  // Standalone location change — doesn't go through the prompt edit-mode
  // workflow. Calls PATCH /shots/:id/location and refetches the shot.
  const changeLocation = async (newLocationId: string | null) => {
    setSavingLoc(true);
    setError(null);
    try {
      await api.assignShotLocation(shotId, newLocationId);
      const fresh = await api.getShot(shotId);
      setShot(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLoc(false);
    }
  };

  return (
    <main className="px-8 py-6 max-w-7xl mx-auto">
      <div className="mb-4 flex gap-2 justify-end">
        {!editing ? (
          <>
            <button onClick={startEdit}
              className="text-sm bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded">
              ✎ редактировать
            </button>
            <button onClick={remove} disabled={busy}
              className="text-sm text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded px-3 py-1.5">
              ✕ удалить кадр
            </button>
          </>
        ) : (
          <>
            <button onClick={save} disabled={busy}
              className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded">
              {busy ? '…' : 'сохранить'}
            </button>
            <button onClick={cancel} disabled={busy}
              className="text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5">
              отмена
            </button>
          </>
        )}
      </div>

      {error && <div className="mb-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>}

      {/* Scene narration — the slice of script.md this shot's scene covers. Shown
          as read-only context so the artist sees what the narrator says over
          this scene without leaving the shot prompts page. */}
      {shot.scene?.narrationText && (
        <section className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <header className="px-4 py-2 border-b border-zinc-800 flex items-baseline justify-between flex-wrap gap-2">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              📖 Сценарий сцены
              <span className="ml-2 normal-case tracking-normal text-zinc-400">
                {shot.scene.title ?? shot.scene.sceneKey}
              </span>
            </div>
            {shot.scene.scriptStartLine && shot.scene.scriptEndLine && (
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-mono">
                script.md: строки {shot.scene.scriptStartLine}–{shot.scene.scriptEndLine}
                {' · '}
                {shot.scene.narrationText.length} символов
              </div>
            )}
          </header>
          <pre className="bg-zinc-950 p-4 text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-72 overflow-y-auto select-text">
            {shot.scene.narrationText}
          </pre>
        </section>
      )}

      {/* Chosen render preview */}
      {shot.chosenRender && (
        <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Выбранный кадр (chosenRender)</div>
          <div className="flex gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.shotImageUrl(shot.id, shot.chosenRender)}
              alt={shot.chosenRender}
              className="max-w-md w-full bg-black rounded border border-zinc-700"
              loading="lazy"
            />
            <div className="text-xs text-zinc-500 font-mono break-all">{shot.chosenRender}</div>
          </div>
        </div>
      )}

      {/* Location picker — independent of edit-mode. Changing it calls
          PATCH /shots/:id/location immediately. The renderer auto-prepends
          location.description to the positive at render time. */}
      <section className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">📍 Локация</div>
            <div className="text-xs text-zinc-600 mt-0.5">
              Описание автоматически добавляется в начало positive при рендере.
            </div>
          </div>
          <a
            href={`/projects/${projectId}/locations`}
            className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
          >
            ✎ управлять локациями →
          </a>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={shot.locationId ?? ''}
            onChange={(e) => changeLocation(e.target.value || null)}
            disabled={savingLocation}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">— без локации (positive используется как есть) —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.slug})
              </option>
            ))}
          </select>
          {savingLocation && <span className="text-xs text-zinc-500">сохраняю…</span>}
        </div>
        {currentLocation && (
          <div className="mt-3 text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed bg-zinc-950 rounded p-3 border border-zinc-800/50 max-h-40 overflow-y-auto">
            {currentLocation.description}
          </div>
        )}
      </section>

      <div className="space-y-4">
        <Field label="Beat (narrativeBeat)" hint="Что происходит в кадре">
          {!editing ? <Value v={pf.narrativeBeat} multi />
                    : <Textarea value={dpf.narrativeBeat ?? ''} rows={3}
                        onChange={(v) => updatePf({ narrativeBeat: v })} />}
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Location (label)">
            {!editing ? <Value v={pf.location?.label} />
                      : <Input value={dpf.location?.label ?? ''}
                          onChange={(v) => updatePf({ location: { ...dpf.location, label: v } })} />}
          </Field>

          <Field label="Interior / Exterior">
            {!editing ? <Value v={pf.location?.interiorExterior} mono />
                      : <Input value={dpf.location?.interiorExterior ?? ''}
                          onChange={(v) => updatePf({ location: { ...dpf.location, interiorExterior: v } })} />}
          </Field>
        </div>

        <Field label="Lighting / Mood">
          {!editing ? <Value v={pf.lightingMood} multi />
                    : <Textarea value={dpf.lightingMood ?? ''} rows={2}
                        onChange={(v) => updatePf({ lightingMood: v })} />}
        </Field>

        <Field label="Frame description" hint="Что должно быть в кадре, без логотипов и т.п.">
          {!editing ? <Value v={pf.frameDescription} multi />
                    : <Textarea value={dpf.frameDescription ?? ''} rows={2}
                        onChange={(v) => updatePf({ frameDescription: v })} />}
        </Field>

        <Field label="Positive prompt" hint="Полный позитивный промпт для ComfyUI">
          {!editing ? <Value v={pf.positive} multi />
                    : <Textarea value={dpf.positive ?? ''} rows={4}
                        onChange={(v) => updatePf({ positive: v })} />}
        </Field>

        <Field label="Negative prompt" hint="SDXL negative — fallback Project.defaultNegative если пусто">
          {!editing ? <Value v={pf.negative} multi />
                    : <Textarea value={dpf.negative ?? ''} rows={3}
                        onChange={(v) => updatePf({ negative: v })} />}
        </Field>

        <Field label="Motion negative (для видео i2v)" hint="Wan2.2 negative — fallback Project.defaultVideoNegative если пусто. Уходит в ноду 10 воркфлоу.">
          {!editing ? <Value v={pf.motionNegative as string | undefined} multi />
                    : <Textarea value={(dpf.motionNegative as string | undefined) ?? ''} rows={3}
                        onChange={(v) => updatePf({ motionNegative: v })} />}
        </Field>

        <Field label="Character locks (positiveCharacterLocks)" hint="Кто/как зафиксирован в кадре">
          {!editing ? <Value v={pf.positiveCharacterLocks} multi />
                    : <Textarea value={dpf.positiveCharacterLocks ?? ''} rows={2}
                        onChange={(v) => updatePf({ positiveCharacterLocks: v })} />}
        </Field>

        <Field label="Environment hints (positiveEnvironment)">
          {!editing ? <Value v={pf.positiveEnvironment} multi />
                    : <Textarea value={dpf.positiveEnvironment ?? ''} rows={2}
                        onChange={(v) => updatePf({ positiveEnvironment: v })} />}
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Camera framing">
            {!editing ? <Value v={pf.camera?.framing} mono />
                      : <Input value={dpf.camera?.framing ?? ''}
                          onChange={(v) => updatePf({ camera: { ...dpf.camera, framing: v } })} />}
          </Field>

          <Field label="Camera movement">
            {!editing ? <Value v={pf.camera?.movement} mono />
                      : <Input value={dpf.camera?.movement ?? ''}
                          onChange={(v) => updatePf({ camera: { ...dpf.camera, movement: v } })} />}
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Workflow route">
            {!editing ? <Value v={shot.workflowRouteKey ?? undefined} mono />
                      : <Input value={(draft.workflowRouteKey ?? shot.workflowRouteKey) ?? ''}
                          onChange={(v) => setDraft((d) => ({ ...d, workflowRouteKey: v }))} />}
          </Field>

          <Field label="Production status (draft/ready/locked)">
            {!editing ? <Value v={pf.production?.promptStatus} mono />
                      : <Input value={dpf.production?.promptStatus ?? ''}
                          onChange={(v) => updatePf({ production: { ...dpf.production, promptStatus: v } })} />}
          </Field>
        </div>

        <Field label="Production notes">
          {!editing ? <Value v={pf.production?.notes} multi />
                    : <Textarea value={dpf.production?.notes ?? ''} rows={2}
                        onChange={(v) => updatePf({ production: { ...dpf.production, notes: v } })} />}
        </Field>
      </div>
    </main>
  );
}
