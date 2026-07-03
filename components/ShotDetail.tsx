'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ShotFull, ShotPromptFields, UpdateShotBody, VideoRender, CandidateVerdict } from '../lib/api';

export function ShotDetail({ projectId, shotId }: { projectId: string; shotId: string }) {
  const router = useRouter();
  const [shot,       setShot]       = useState<ShotFull | null>(null);
  const [characters, setCharacters] = useState<Awaited<ReturnType<typeof api.listCharacters>>>([]);
  const [error,      setError]      = useState<string | null>(null);
  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState<UpdateShotBody>({});
  const [busy,       setBusy]       = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, chs] = await Promise.all([api.getShot(shotId), api.listCharacters(projectId)]);
      setShot(s);
      setCharacters(chs);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [shotId, projectId]);

  useEffect(() => { load(); }, [load]);

  if (error)  return <Pad><Err msg={error} /></Pad>;
  if (!shot)  return <Pad><p className="text-zinc-500">Loading…</p></Pad>;

  const pf  = shot.promptFields ?? {};
  const dpf = (draft.promptFields ?? pf) as ShotPromptFields;

  const startEdit = () => {
    setDraft({
      shotCode:     shot.shotCode,
      promptFields: { ...pf },
      participants: shot.participants.map((p) => ({
        label:       p.label,
        characterId: p.characterId,
        profileId:   p.profileId,
      })),
    });
    setEditing(true);
  };

  const cancel = () => { setEditing(false); setDraft({}); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const updated = await api.updateShot(shotId, draft);
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

  return (
    <main className="px-4 sm:px-8 py-6">
      <Link href={`/projects/${projectId}/scenes`} className="text-zinc-500 hover:text-zinc-200 text-sm mb-4 inline-block">
        ← все сцены
      </Link>

      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-zinc-500 text-xs font-mono mb-1">{shot.scene?.title ?? shot.scene?.sceneKey}</div>
          <h1 className="text-2xl font-semibold font-mono">{shot.shotCode}</h1>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button onClick={startEdit}
                className="text-sm bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded">
                ✎ редактировать
              </button>
              <button onClick={remove} disabled={busy}
                className="text-sm text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded px-3 py-1.5">
                ✕ удалить
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
      </header>

      {error && <div className="mb-4 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>}

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

        <Field label="Negative prompt">
          {!editing ? <Value v={pf.negative} multi />
                    : <Textarea value={dpf.negative ?? ''} rows={3}
                        onChange={(v) => updatePf({ negative: v })} />}
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

        <ParticipantsEditor
          editing={editing}
          participants={editing ? (draft.participants ?? []) : shot.participants.map((p) => ({
            label:       p.label,
            characterId: p.characterId,
            profileId:   p.profileId,
          }))}
          characters={characters}
          shotParticipants={shot.participants}
          isCartoon={(shot.project?.visualStyle ?? 'photoreal_cinematic') !== 'photoreal_cinematic'}
          onChange={(parts) => setDraft((d) => ({ ...d, participants: parts }))}
        />

        {!editing && (
          <>
            <p className="text-zinc-600 text-xs mt-3">
              Чтобы поменять персонажей или какой профиль брать (например HERO_TEEN_15 vs HERO_OVERLOAD_16) — нажми «✎ редактировать» вверху.
            </p>
            <RenderSection shot={shot} onShotChange={setShot} />
            <VideoSection projectId={projectId} shot={shot} />
          </>
        )}
      </div>
    </main>
  );
}

// ── Small UI primitives ─────────────────────────────────────────────────────

function Pad({ children }: { children: React.ReactNode }) {
  return <main className="px-4 sm:px-8 py-6">{children}</main>;
}
function Err({ msg }: { msg: string }) {
  return <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{msg}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
        {label}
        {hint && <span className="text-zinc-600 normal-case tracking-normal ml-2">— {hint}</span>}
      </div>
      {children}
    </div>
  );
}
export function Value({ v, multi, mono }: { v?: string; multi?: boolean; mono?: boolean }) {
  if (!v) return <span className="text-zinc-600 text-sm italic">—</span>;
  if (multi) return <pre className={`text-sm text-zinc-300 whitespace-pre-wrap ${mono ? 'font-mono' : 'font-sans'} break-words`}>{v}</pre>;
  return <span className={`text-sm text-zinc-300 ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>;
}
export function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text" value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 font-mono focus:border-blue-600 focus:outline-none"
    />
  );
}
export function Textarea({ value, rows, onChange }: { value: string; rows: number; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-600 focus:outline-none"
    />
  );
}

// ── Render section: gated on identity readiness ─────────────────────────────
// Cartoon projects (Project.visualStyle != 'photoreal_cinematic') carry identity
// via profile.promptBase + triggerToken (and optional anchor PNG for IP-Adapter).
// Photoreal projects need a trained LoRA per participant. Branch the gating.

export function RenderSection({ shot, onShotChange }: { shot: ShotFull; onShotChange: (s: ShotFull) => void }) {
  // The pipeline queue owns dispatch + ComfyUI polling + persisting outputs to
  // shot.renderedImages. The UI just enqueues, then polls the shot until the
  // render count grows (or the scene job lands in `failed`/`cancelled`).
  const [state, setState] = useState<{
    status:    'idle' | 'queued' | 'running' | 'error';
    sceneJobId?: string;
    error?:    string;
  }>({ status: 'idle' });
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const initialRenderCount = useRef<number>(shot.renderedImages?.length ?? 0);

  const visualStyle = shot.project?.visualStyle ?? 'photoreal_cinematic';
  const isCartoon   = visualStyle !== 'photoreal_cinematic';

  // ── Per-generation tweaks (NOT the pipeline) ───────────────────────────────
  // The workflow/pipeline (visual style + comic LoRA + Flux base) is configured
  // ONCE per project (project.visualStyle + settings.styleLora/fluxBaseModel on
  // the Settings page) — NOT per scene. Here we only expose lightweight
  // per-generation knobs: how many variants, and optional sampler tweaks.
  const isFluxStyle = visualStyle === 'graphic_novel_flux';
  const [batchSize,    setBatchSize]    = useState<number>(5);
  const [steps,        setSteps]        = useState<number | ''>('');
  const [guidance,     setGuidance]     = useState<number | ''>('');
  const [loraStrength, setLoraStrength] = useState<number | ''>('');

  // Per-participant identity readiness. Cartoon needs promptBase+triggerToken;
  // photoreal needs a trained LoRA. Status carries one of:
  //   ready    — identity asset present, render allowed
  //   no_lora  — photoreal participant has no trained LoRA yet
  //   no_id    — cartoon participant has no promptBase/triggerToken (seeding gap)
  //   unbound  — participant exists in the slot but no character attached
  const checks = shot.participants.map((p) => {
    if (!p.character) return { p, status: 'unbound' as const, profileCode: null as string | null };
    if (isCartoon) {
      // Cartoon: identity carried by promptBase + triggerToken.
      const profile = (p.profile && p.profile.promptBase && p.profile.triggerToken)
        ? p.profile
        : p.character.profiles?.find((pp) => pp.promptBase && pp.triggerToken);
      if (!profile) return { p, status: 'no_id' as const, profileCode: null };
      const explicit = !!p.profile;
      return { p, status: 'ready' as const, profileCode: profile.profileCode, explicit };
    }
    // Photoreal: identity needs a trained LoRA.
    const profile = p.profile && p.profile.loraPath
      ? p.profile
      : p.character.profiles?.find((pp) => pp.loraPath);
    if (!profile)         return { p, status: 'no_lora'  as const, profileCode: null };
    if (!profile.loraPath) return { p, status: 'no_lora'  as const, profileCode: profile.profileCode };
    const explicit = !!p.profile;
    return { p, status: 'ready' as const, profileCode: profile.profileCode, explicit };
  });

  // Effective character count = participants bound to a character (unbound = silhouettes / extras, no LoRA needed)
  const charCount = checks.filter((c) => c.status !== 'unbound').length;

  // Are all bound participants' LoRAs ready?
  const allReady = charCount === 0 || checks.filter((c) => c.status !== 'unbound').every((c) => c.status === 'ready');

  // Strategies registered per style.
  //   photoreal: environment (0), single-character (1), dual-regional 2-LoRA (2)
  //   cartoon:   environment (0), single-character (1), dual-regional text (2)
  // Cartoon dual uses regional TEXT conditioning (ConditioningSetArea), no
  // character LoRA / no IP-Adapter weights — so 2 is supported for both styles.
  const supportedByStrategy = (charCount === 0 || charCount === 1 || charCount === 2);

  const canRender = allReady && supportedByStrategy && state.status !== 'queued' && state.status !== 'running';

  // Poll the pipeline queue until our scene job finishes. The pipeline server-
  // side persists the rendered filenames to shot.renderedImages, so we just
  // refresh the shot when the job lands in a terminal state.
  useEffect(() => {
    if ((state.status !== 'queued' && state.status !== 'running') || !state.sceneJobId) return;
    const t = setInterval(async () => {
      try {
        const snap = await api.pipelineQueue({ id: state.sceneJobId, type: ['scene'], limit: 1 });
        const found = snap.rows[0];
        if (!found) return;
        if (found.status === 'pending')  { setState((s) => ({ ...s, status: 'queued'  })); return; }
        if (found.status === 'running')  { setState((s) => ({ ...s, status: 'running' })); return; }
        if (found.status === 'completed') {
          // Refresh shot to pick up the newly appended renderedImages
          try { onShotChange(await api.getShot(shot.id)); } catch { /* display still works */ }
          setState({ status: 'idle' });
          return;
        }
        if (found.status === 'failed' || found.status === 'cancelled') {
          setState({ status: 'error', error: found.errorMessage ?? `Scene job ${found.status}` });
          return;
        }
      } catch (e) {
        setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }, 3000);
    return () => clearInterval(t);
  }, [state.status, state.sceneJobId, shot.id, onShotChange]);

  const handleRender = async () => {
    setState({ status: 'queued' });
    initialRenderCount.current = shot.renderedImages?.length ?? 0;
    try {
      const body: Parameters<typeof api.enqueueShotRender>[1] = {
        seed:      Math.floor(Math.random() * 2 ** 32),
        batchSize,
      };
      if (steps        !== '') body.steps        = Number(steps);
      if (guidance     !== '') body.guidance     = Number(guidance);
      if (loraStrength !== '') body.loraStrength = Number(loraStrength);
      // No visualStyle here on purpose — the pipeline is a per-PROJECT setting
      // (Settings page), not a per-scene choice. The backend resolves the style
      // from the project.
      const job = await api.enqueueShotRender(shot.id, body);
      setState({ status: 'queued', sceneJobId: job.id });
    } catch (e) {
      setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      const updated = await api.removeShotRender(shot.id, filename);
      onShotChange(updated);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  const handleChoose = async (filename: string | null) => {
    try {
      const updated = await api.setChosenRender(shot.id, filename);
      onShotChange(updated);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  // ── Image validation (Ollama vision picks the best candidate) ──────────────
  const [pendingValId, setPendingValId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft]   = useState('');
  const [applyingPrompt, setApplyingPrompt] = useState(false);
  const handleValidate = async () => {
    try {
      const res = await api.validateShot(shot.id);
      if (!res.queued) { alert('Для проверки нужно ≥2 вариантов (или проверка уже в очереди).'); return; }
      setPendingValId(res.jobId);
      // Backend cleared the old pick on re-check — refresh so it disappears now.
      try { onShotChange(await api.getShot(shot.id)); } catch { /* poll will catch up */ }
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };
  // Poll the shot until the queued validation job reaches a terminal state.
  useEffect(() => {
    if (!pendingValId) return;
    const t = setInterval(async () => {
      try {
        const fresh = await api.getShot(shot.id);
        onShotChange(fresh);
        const job = fresh.validationJobs?.find((j) => j.id === pendingValId);
        if (job && (job.status === 'completed' || job.status === 'failed')) setPendingValId(null);
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [pendingValId, shot.id, onShotChange]);

  const renders = shot.renderedImages ?? [];
  const latestValidation = shot.validationJobs?.[0];
  const verdictByFile = new Map<string, CandidateVerdict>();
  for (const v of latestValidation?.result ?? []) verdictByFile.set(v.filename, v);
  const validating = pendingValId !== null
    || latestValidation?.status === 'running' || latestValidation?.status === 'pending';
  // When the last completed validation picked NOTHING (all candidates failed),
  // the vision model proposes an improved prompt for the user to review/approve.
  const suggestion = latestValidation?.status === 'completed' && !latestValidation.chosenFilename
    ? (latestValidation.suggestedPrompt ?? null)
    : null;
  useEffect(() => { if (suggestion != null) setPromptDraft(suggestion); }, [suggestion]);
  const applyPrompt = async (rerender: boolean) => {
    if (!promptDraft.trim()) return;
    setApplyingPrompt(true);
    try {
      const updated = await api.applySuggestedPrompt(shot.id, promptDraft.trim(), rerender);
      onShotChange(updated);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setApplyingPrompt(false); }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mt-6">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Рендер кадра в ComfyUI</h3>

      <div className="space-y-2 mb-4">
        {checks.length === 0 && (
          <p className="text-zinc-500 text-sm">Нет participants — нечего рендерить.</p>
        )}
        {checks.map((c, i) => (
          <div key={i} className="flex gap-2 text-xs items-center">
            <span className={`w-4 ${c.status === 'ready' ? 'text-emerald-400' : (c.status === 'no_lora' || c.status === 'no_id') ? 'text-amber-400' : 'text-red-400'}`}>
              {c.status === 'ready' ? '✓' : (c.status === 'no_lora' || c.status === 'no_id') ? '⚠' : '✕'}
            </span>
            <span className="text-zinc-500 font-mono w-24 flex-shrink-0">{c.p.label}</span>
            <span className="text-zinc-300 flex-1">
              {c.p.character ? `${c.p.character.code} (${c.p.character.displayName ?? '—'})` : <em className="text-zinc-600">unbound</em>}
            </span>
            {c.profileCode && (
              <span className="text-zinc-400 font-mono">
                {c.profileCode}{c.status === 'ready' && c.explicit ? ' (явно)' : c.status === 'ready' ? ' (авто)' : ''}
              </span>
            )}
            {c.status === 'no_lora' && <span className="text-amber-400">— LoRA не обучена</span>}
            {c.status === 'no_id'   && <span className="text-amber-400">— нет promptBase/triggerToken у профиля</span>}
            {c.status === 'unbound' && <span className="text-red-400">— персонаж не привязан</span>}
          </div>
        ))}
      </div>

      {!supportedByStrategy && charCount > 2 && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded p-3 mb-3 text-xs text-amber-200">
          ⚠ Сейчас есть стратегии только на 0, 1 и 2 персонажей.
          Для {charCount} персонажей пайплайн ещё не построен.
        </div>
      )}

      {charCount === 0 && (
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 mb-3 text-xs text-zinc-400">
          Кадр без персонажей — рендерится по промпту (positive/negative из поля).
          Workflow: <code>{!isCartoon ? 'scene_environment' : visualStyle === 'graphic_novel_flux' ? 'scene_environment_flux_comic' : 'scene_environment_graphic_novel'}</code>.
        </div>
      )}

      {charCount === 1 && isCartoon && (
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 mb-3 text-xs text-zinc-400">
          Cartoon-кадр (1 персонаж) — идентичность через <code>promptBase</code> +{' '}
          <code>triggerToken</code> (LoRA не нужна). Workflow:{' '}
          <code>{visualStyle === 'graphic_novel_flux' ? 'scene_single_character_flux_comic' : 'scene_single_character_graphic_novel'}</code>.
        </div>
      )}

      {charCount === 2 && !isCartoon && (
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 mb-3 text-xs text-zinc-400">
          Кадр с 2 персонажами — regional prompter, левая половина = первый,
          правая = второй. Workflow: <code>scene_dual_character_regional</code>.
          Лица не сливаются, LoRA strength снижен до 0.85 для обоих.
        </div>
      )}

      {charCount === 2 && isCartoon && (
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 mb-3 text-xs text-zinc-400">
          Cartoon-кадр (2 персонажа) — региональное разделение по тексту:
          левая половина = первый participant, правая = второй. Идентичность из{' '}
          <code>promptBase</code> каждого, без LoRA и без IP-Adapter-весов. Workflow:{' '}
          <code>{visualStyle === 'graphic_novel_flux' ? 'scene_dual_character_flux_comic' : 'scene_dual_character_graphic_novel'}</code>{' '}(первая версия, тест).
        </div>
      )}

      {/* ── Per-generation tweaks (the pipeline itself is configured once per project) ── */}
      <div className="bg-zinc-800/40 border border-zinc-700/50 rounded p-3 mb-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            вариантов
            <input
              type="number" min={1} max={8} value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 w-16"
            />
          </label>

          <label className="text-xs text-zinc-400 flex items-center gap-1">
            steps
            <input
              type="number" min={1} max={60} value={steps} placeholder="авто"
              onChange={(e) => setSteps(e.target.value === '' ? '' : Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 w-16"
            />
          </label>

          {isFluxStyle && (
            <label className="text-xs text-zinc-400 flex items-center gap-1" title="FluxGuidance (cfg на Flux всегда 1.0)">
              guidance
              <input
                type="number" min={0} max={10} step={0.5} value={guidance} placeholder="3.5"
                onChange={(e) => setGuidance(e.target.value === '' ? '' : Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 w-16"
              />
            </label>
          )}

          {isCartoon && (
            <label className="text-xs text-zinc-400 flex items-center gap-1" title="Сила style-LoRA (node 2)">
              LoRA
              <input
                type="number" min={0} max={2} step={0.05} value={loraStrength} placeholder="1.0"
                onChange={(e) => setLoraStrength(e.target.value === '' ? '' : Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 w-16"
              />
            </label>
          )}
        </div>

        {isFluxStyle && (
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Flux-комикс: модель/стиль настраивается ОДИН раз на проект (вкладка «Настройки» →
            <code>Flux база</code> + <code>Стиль (LoRA)</code>). Идентичность — <code>promptBase</code>,
            плюс Flux Redux по анкеру, если он есть и установлены модели Redux.
          </p>
        )}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={handleRender}
          disabled={!canRender}
          className="bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
        >
          {state.status === 'queued'  ? '⏳ в очереди…'
          : state.status === 'running' ? '⚙ рендерится…'
          : renders.length > 0          ? `+ ещё ${batchSize} вариантов в очередь (всего: ${renders.length})`
          : `🎬 в очередь — ${batchSize} вариантов`}
        </button>
        {state.sceneJobId && (state.status === 'queued' || state.status === 'running') && (
          <Link href="/queue" className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">
            job: {state.sceneJobId.slice(0, 8)}… →
          </Link>
        )}
      </div>

      {state.error && (
        <div className="mt-3 bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{state.error}</div>
      )}

      {/* Gallery of all rendered variants */}
      {renders.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-2">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Варианты ({renders.length})</span>
            {shot.chosenRender && <span className="text-xs text-emerald-400">✓ выбран: <span className="font-mono">{shot.chosenRender}</span></span>}
            {renders.length >= 2 && (
              <button
                onClick={handleValidate}
                disabled={validating}
                className="text-xs bg-indigo-700/80 hover:bg-indigo-600 disabled:opacity-50 text-white px-2 py-0.5 rounded"
                title="Vision-модель (qwen3-vl) оценит все варианты и выберет лучший под промпт"
              >
                {validating ? '🤖 проверяю…' : '🤖 перепроверить'}
              </button>
            )}
            {latestValidation?.status === 'failed' && (
              <span className="text-xs text-red-400" title={latestValidation.errorMessage ?? ''}>✕ проверка не удалась</span>
            )}
          </div>

          {suggestion && (
            <div className="mb-3 bg-amber-950/30 border border-amber-800/60 rounded p-3">
              <div className="text-xs text-amber-300 mb-2">
                🤖 Ни один вариант не прошёл проверку — ИИ предлагает новый промпт (можно отредактировать):
              </div>
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={4}
                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-zinc-200 font-mono leading-relaxed"
              />
              <div className="flex gap-2 mt-2 items-center">
                <button
                  onClick={() => applyPrompt(false)}
                  disabled={applyingPrompt || !promptDraft.trim()}
                  className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1 rounded"
                >
                  ✓ Применить промпт
                </button>
                <button
                  onClick={() => applyPrompt(true)}
                  disabled={applyingPrompt || !promptDraft.trim()}
                  className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-1 rounded"
                  title="Записать промпт, удалить неудачные варианты и поставить новый рендер в очередь"
                >
                  ✓ Применить и перерендерить
                </button>
                {applyingPrompt && <span className="text-xs text-zinc-500">…</span>}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {renders.map((r, idx) => {
              const chosen = r.filename === shot.chosenRender;
              const verdict = verdictByFile.get(r.filename);
              const aiPicked = latestValidation?.chosenFilename === r.filename;
              const scoreColor = verdict == null || verdict.score < 0 ? 'bg-zinc-700 text-zinc-300'
                : verdict.score >= 75 ? 'bg-emerald-700 text-white'
                : verdict.score >= 50 ? 'bg-amber-600 text-white'
                : 'bg-red-700 text-white';
              return (
                <div
                  key={r.filename}
                  className={`relative bg-zinc-900 border rounded overflow-hidden cursor-zoom-in ${chosen ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-zinc-800'}`}
                  onClick={() => setLightboxIdx(idx)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.shotImageUrl(shot.id, r.filename)}
                    alt={r.filename}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                  <div className="absolute top-2 left-2 flex flex-col gap-1 items-start pointer-events-none">
                    <div className="bg-black/70 backdrop-blur text-[10px] text-zinc-300 font-mono px-2 py-0.5 rounded">
                      {r.filename}
                    </div>
                    {verdict && (
                      <div className="flex gap-1 items-center">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${scoreColor}`}>
                          {verdict.score < 0 ? '⚠ err' : `${verdict.score}`}
                        </span>
                        {verdict.score >= 0 && (
                          <span className={`text-[10px] px-1 py-0.5 rounded ${verdict.matchesPrompt ? 'bg-emerald-900/80 text-emerald-300' : 'bg-red-900/80 text-red-300'}`}>
                            {verdict.matchesPrompt ? 'по промпту' : 'не по промпту'}
                          </span>
                        )}
                        {verdict.severe && <span className="text-[10px] bg-red-700 text-white px-1 py-0.5 rounded">⛔ брак</span>}
                        {aiPicked && <span className="text-[10px] bg-indigo-700 text-white px-1 py-0.5 rounded">🤖 лучший</span>}
                      </div>
                    )}
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1">
                    {!chosen ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleChoose(r.filename); }}
                        className="text-xs bg-emerald-700/90 hover:bg-emerald-600 text-white px-2 py-0.5 rounded"
                      >
                        ✓ выбрать
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleChoose(null); }}
                        className="text-xs bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded"
                      >
                        снять выбор
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить вариант ${r.filename}?`)) handleDelete(r.filename); }}
                      className="text-xs bg-red-600/90 hover:bg-red-500 text-white px-2 py-0.5 rounded"
                    >
                      ✕
                    </button>
                  </div>
                  {verdict && verdict.issues.length > 0 && (
                    <div className={`absolute left-0 right-0 ${chosen ? 'bottom-6' : 'bottom-0'} bg-black/75 backdrop-blur text-[10px] text-amber-300 px-2 py-1 pointer-events-none`}>
                      ⚠ {verdict.issues.slice(0, 3).join(' · ')}
                    </div>
                  )}
                  {chosen && (
                    <div className="absolute bottom-0 left-0 right-0 bg-emerald-700/90 text-white text-xs text-center py-1 font-medium pointer-events-none">
                      {aiPicked ? '🤖 выбрано ИИ' : 'выбрано для сцены'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lightboxIdx !== null && renders[lightboxIdx] && (
        <RenderLightbox
          shotId={shot.id}
          renders={renders}
          index={lightboxIdx}
          chosenFilename={shot.chosenRender}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
          onChoose={async (filename) => {
            await handleChoose(filename);
          }}
          onDelete={async (filename) => {
            await handleDelete(filename);
            setLightboxIdx((i) => {
              if (i === null) return null;
              const newLen = renders.length - 1;
              if (newLen === 0) return null;
              return Math.min(i, newLen - 1);
            });
          }}
        />
      )}
    </section>
  );
}

// ── Lightbox for rendered variants (full-size, keyboard nav, choose/delete) ─

function RenderLightbox({
  shotId, renders, index, chosenFilename, onClose, onNavigate, onChoose, onDelete,
}: {
  shotId:         string;
  renders:        ShotFull['renderedImages'] extends infer R ? (R extends Array<infer X> ? X[] : never) : never;
  index:          number;
  chosenFilename: string | null;
  onClose:        () => void;
  onNavigate:     (i: number) => void;
  onChoose:       (filename: string | null) => Promise<void> | void;
  onDelete:       (filename: string) => Promise<void> | void;
}) {
  const cur = renders[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      onClose();
      else if (e.key === 'ArrowLeft' && index > 0)              onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && index < renders.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, renders.length, onClose, onNavigate]);

  if (!cur) return null;
  const isChosen = cur.filename === chosenFilename;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
        <div className="text-zinc-400 text-xs font-mono">
          {index + 1} / {renders.length} · {cur.filename}
          {isChosen && <span className="ml-3 text-emerald-400">✓ выбран для сцены</span>}
        </div>
        <div className="flex gap-2">
          {!isChosen ? (
            <button
              onClick={(e) => { e.stopPropagation(); onChoose(cur.filename); }}
              className="text-xs bg-emerald-700/90 hover:bg-emerald-600 text-white px-3 py-1 rounded"
            >
              ✓ выбрать
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onChoose(null); }}
              className="text-xs bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 px-3 py-1 rounded"
            >
              снять выбор
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Удалить ${cur.filename}?`)) onDelete(cur.filename);
            }}
            className="text-xs bg-red-700/80 hover:bg-red-600 text-white px-3 py-1 rounded"
          >
            ✕ удалить
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-xs bg-zinc-800/80 hover:bg-zinc-700 text-white px-3 py-1 rounded"
          >
            ESC
          </button>
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={api.shotImageUrl(shotId, cur.filename)}
        alt={cur.filename}
        className="max-w-[95vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl bg-black/50 hover:bg-black/80 rounded-full w-12 h-12 flex items-center justify-center"
        >‹</button>
      )}
      {index < renders.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl bg-black/50 hover:bg-black/80 rounded-full w-12 h-12 flex items-center justify-center"
        >›</button>
      )}
    </div>
  );
}

// ── Participants editor ─────────────────────────────────────────────────────

export interface ParticipantDraft {
  label:        string;
  characterId?: string | null;
  profileId?:   string | null;
}

export function ParticipantsEditor({
  editing, participants, characters, shotParticipants, isCartoon = false, onChange,
}: {
  editing:          boolean;
  participants:     ParticipantDraft[];
  characters:       Awaited<ReturnType<typeof api.listCharacters>>;
  shotParticipants: ShotFull['participants'];
  /** True when project.visualStyle != 'photoreal_cinematic'. Switches LoRA-label
   *  copy to profile/identity wording and skips the "нет LoRA" amber state
   *  (cartoon profiles render via promptBase + triggerToken, no LoRA needed). */
  isCartoon?:       boolean;
  onChange:         (parts: ParticipantDraft[]) => void;
}) {
  const updateRow = (idx: number, patch: Partial<ParticipantDraft>) => {
    const next = participants.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange(next);
  };
  const addRow    = () => onChange([...participants, { label: 'character', characterId: null, profileId: null }]);
  const removeRow = (idx: number) => onChange(participants.filter((_, i) => i !== idx));

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mt-6">
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">Participants ({participants.length})</h3>
        {editing && (
          <button
            type="button" onClick={addRow}
            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5 rounded"
          >
            + добавить
          </button>
        )}
      </header>

      {participants.length === 0 ? (
        <p className="text-zinc-500 text-sm">Нет персонажей в кадре{editing ? '. Жми «+ добавить».' : '.'}</p>
      ) : !editing ? (
        <ul className="text-sm space-y-1">
          {shotParticipants.map((p) => {
            const profile = p.profile;
            const charProfiles = p.character?.profiles ?? [];
            const usedProfile = profile
              ?? (isCartoon
                ? charProfiles.find((pp) => pp.promptBase && pp.triggerToken)
                : charProfiles.find((pp) => pp.loraPath));
            const label = isCartoon ? 'Profile' : 'LoRA';
            return (
              <li key={p.id} className="flex gap-3 items-baseline">
                <span className="text-zinc-500 font-mono text-xs w-24 flex-shrink-0">{p.label}</span>
                <span className="text-zinc-300 flex-1 min-w-0">
                  {p.character ? (
                    <>
                      {p.character.code} <span className="text-zinc-500">({p.character.displayName ?? '—'})</span>
                    </>
                  ) : <em className="text-zinc-600">unbound</em>}
                </span>
                {usedProfile && (
                  <span className="text-xs font-mono text-zinc-400">
                    {label}: <span className={profile ? 'text-emerald-400' : 'text-amber-400'}>
                      {usedProfile.profileCode}
                    </span>
                    {!profile && <span className="text-zinc-600 ml-1">(авто)</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-3">
          {participants.map((p, idx) => {
            const charProfiles = characters.find((c) => c.id === p.characterId)?.profiles ?? [];
            return (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
                <input
                  type="text" value={p.label} onChange={(e) => updateRow(idx, { label: e.target.value })}
                  placeholder="label"
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-blue-600 focus:outline-none"
                />
                <select
                  value={p.characterId ?? ''}
                  onChange={(e) => updateRow(idx, { characterId: e.target.value || null, profileId: null })}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">— персонаж —</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} ({c.displayName ?? '—'})</option>
                  ))}
                </select>
                <select
                  value={p.profileId ?? ''}
                  onChange={(e) => updateRow(idx, { profileId: e.target.value || null })}
                  disabled={!p.characterId || charProfiles.length === 0}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                >
                  <option value="">{(isCartoon ? 'Profile' : 'LoRA') + (charProfiles.length > 1 ? ': авто —' : ': авто')}</option>
                  {charProfiles.map((pp) => {
                    const ready = isCartoon
                      ? !!(pp.promptBase && pp.triggerToken)
                      : !!pp.loraPath;
                    const badge = ready ? ' ✓' : (isCartoon ? ' — нет промпта' : ' — нет LoRA');
                    return (
                      <option key={pp.id} value={pp.id}>
                        {pp.profileCode}{pp.ageLabel ? ` (${pp.ageLabel})` : ''}{badge}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button" onClick={() => removeRow(idx)}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 rounded px-2 py-1"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <p className="text-zinc-600 text-xs">
            Если у персонажа есть несколько профилей (HERO_TEEN_15 / HERO_OVERLOAD_16 / HERO_RECOVERY_17),
            выбери в третьем поле какой профиль использовать в этом кадре. «авто» = первый{' '}
            {isCartoon ? 'с promptBase + triggerToken' : 'с обученной LoRA'}.
          </p>
        </div>
      )}
    </section>
  );
}

// ── Video render section (Wan2.2 i2v from the chosen render) ────────────────

export function VideoSection({ projectId, shot }: {
  projectId: string;
  shot: ShotFull;
}) {
  const [motionPrompt, setMotionPrompt] = useState('');
  const [videos,       setVideos]       = useState<VideoRender[] | null>(null);
  const [busy,         setBusy]         = useState<false | 'start'>(false);
  const [error,        setError]        = useState<string | null>(null);
  const [count,        setCount]        = useState(1);

  const refresh = useCallback(() => {
    api.listVideosForShot(shot.id).then(setVideos).catch(() => setVideos([]));
  }, [shot.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while anything is pending/running so the UI flips to "completed"
  // without the user reloading.
  useEffect(() => {
    if (!videos) return;
    const hasInFlight = videos.some((v) => v.status === 'pending' || v.status === 'running');
    if (!hasInFlight) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [videos, refresh]);

  if (!shot.chosenRender) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mt-6">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Видео (Wan2.2 i2v)</h3>
        <p className="text-zinc-500 text-sm">Сначала выберите финальный рендер (✓ approved) — он пойдёт первым кадром видео.</p>
      </section>
    );
  }

  const start = async () => {
    setBusy('start'); setError(null);
    try {
      await api.startVideoRender(shot.id, {
        motionPrompt: motionPrompt.trim() || undefined,
        count,
      });
      setMotionPrompt('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mt-6">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Видео (Wan2.2 i2v)</h3>

      <p className="text-zinc-500 text-xs mb-2">
        Первый кадр: <code className="text-zinc-300">{shot.chosenRender}</code> · 832×480 → апскейл 1920×1080 · 81 кадр · 16 fps (~5 сек)
      </p>

      <div className="mb-2">
        <textarea
          value={motionPrompt}
          rows={3}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="Motion prompt — что должно происходить в кадре (камера, движение тела). Можно оставить пустым."
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono"
        />
      </div>

      <div className="flex gap-2 flex-wrap items-center mb-3">
        <button
          onClick={start}
          disabled={busy !== false}
          className="bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded"
        >
          {busy === 'start' ? '⏳ ставим в очередь…' : `🎬 рендерить ${count > 1 ? `${count} видео` : 'видео'}`}
        </button>
        <label className="flex items-center gap-1 text-zinc-400 text-xs">
          количество
          <input
            type="number"
            min={1}
            max={8}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            className="w-14 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 text-center"
          />
        </label>
        {error && <span className="text-red-400 text-xs">{error}</span>}
      </div>

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1 flex items-baseline justify-between">
          <span>Сгенерированные видео</span>
          <Link
            href={`/projects/${projectId}/shots/${shot.id}/videos`}
            className="text-[10px] text-blue-400 hover:text-blue-300 normal-case tracking-normal"
          >
            посмотреть все →
          </Link>
        </div>
        {videos === null && <p className="text-zinc-500 text-xs">Loading…</p>}
        {videos && videos.length === 0 && <p className="text-zinc-600 text-xs italic">Пока ничего нет.</p>}
        {videos && videos.map((v) => (
          <Link
            key={v.id}
            href={`/projects/${projectId}/shots/${shot.id}/videos/${v.id}`}
            className="block px-3 py-2 bg-zinc-950 border border-zinc-800 hover:border-zinc-600 rounded text-xs flex gap-3 items-center"
          >
            <VideoStatusBadge status={v.status} />
            <span className="font-mono text-zinc-500 flex-shrink-0">{new Date(v.queuedAt).toLocaleTimeString()}</span>
            <span className="text-zinc-300 truncate flex-1">{v.motionPrompt || <em className="text-zinc-600">no prompt</em>}</span>
            <span className="text-zinc-600">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function VideoStatusBadge({ status }: { status: VideoRender['status'] }) {
  const map: Record<VideoRender['status'], { label: string; cls: string }> = {
    pending:   { label: '⏳ pending',   cls: 'text-amber-300 bg-amber-900/40' },
    running:   { label: '⚙ running',   cls: 'text-blue-300 bg-blue-900/40' },
    completed: { label: '✓ completed', cls: 'text-emerald-300 bg-emerald-900/40' },
    failed:    { label: '✕ failed',    cls: 'text-red-300 bg-red-900/40' },
    cancelled: { label: '○ cancelled', cls: 'text-zinc-400 bg-zinc-800/40' },
  };
  const m = map[status] ?? { label: status, cls: 'text-zinc-300 bg-zinc-800/40' };
  return <span className={`${m.cls} text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0`}>{m.label}</span>;
}
