'use client';

import { useEffect, useState, use } from 'react';
import { api, ProjectFull, UpdateProjectBody, StyleLoraItem } from '@/lib/api';
import { ProjectTTSSettings } from '@/components/ProjectTTSSettings';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

/** Read the currently-selected style LoRA name out of project.settings. */
function styleLoraNameOf(settings: unknown): string {
  const s = (settings as { styleLora?: unknown } | null | undefined)?.styleLora;
  if (!s) return '';
  if (typeof s === 'string') return s;
  if (typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string') {
    return (s as { name: string }).name;
  }
  return '';
}

/** Shot-boundary transition preset out of project.settings. Anything other
 *  than the literal 'comic' is the legacy rotation. */
type TransitionPreset = 'default' | 'comic';
function transitionPresetOf(settings: unknown): TransitionPreset {
  const s = (settings as { transitionPreset?: unknown } | null | undefined)?.transitionPreset;
  return s === 'comic' ? 'comic' : 'default';
}

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [scriptText, setScriptText] = useState<string>('');
  const [draft, setDraft]   = useState<UpdateProjectBody>({});
  const [status, setStatus] = useState<Status>('loading');
  const [error,  setError]  = useState<string | null>(null);

  // Per-project comic style-LoRA. '' = use the workflow's baked default.
  const [styleLoras, setStyleLoras]           = useState<StyleLoraItem[]>([]);
  const [styleLora, setStyleLora]             = useState<string>('');
  const [initialStyleLora, setInitialStyleLora] = useState<string>('');

  // Shot-boundary transition preset for the CapCut export. '' default rotation
  // vs 'comic' (Comic Tear 90% / Sticker 5% / Glitch Collage 5%).
  const [transitionPreset, setTransitionPreset]             = useState<TransitionPreset>('default');
  const [initialTransitionPreset, setInitialTransitionPreset] = useState<TransitionPreset>('default');

  useEffect(() => {
    (async () => {
      try {
        setStatus('loading');
        const [proj, script, loras] = await Promise.all([
          api.getProject(id),
          api.getProjectScript(id),
          api.listStyleLoras().catch(() => [] as StyleLoraItem[]),
        ]);
        setProject(proj);
        setScriptText(script.text ?? '');
        setStyleLoras(loras);
        const cur = styleLoraNameOf(proj.settings);
        setStyleLora(cur);
        setInitialStyleLora(cur);
        const curPreset = transitionPresetOf(proj.settings);
        setTransitionPreset(curPreset);
        setInitialTransitionPreset(curPreset);
        setStatus('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, [id]);

  if (status === 'loading' || !project) {
    return <main className="px-8 py-6 max-w-7xl mx-auto"><p className="text-zinc-500">Загрузка…</p></main>;
  }

  // Pick the effective value for an input — draft overrides the saved project.
  const v = <K extends keyof UpdateProjectBody>(k: K): string =>
    (draft[k] as string | undefined) ?? (project[k as keyof ProjectFull] as string | null ?? '') as string;

  const dirty =
    Object.keys(draft).length > 0
    || styleLora !== initialStyleLora
    || transitionPreset !== initialTransitionPreset
    || scriptText !== (project ? '' : '') /* always allow script save */;

  const onChange = <K extends keyof UpdateProjectBody>(k: K, val: string) => {
    setDraft((d) => ({ ...d, [k]: val }));
  };

  const save = async () => {
    setStatus('saving'); setError(null);
    try {
      // Save the prompt fields via PATCH /projects/:id; backend rejects empty
      // strings on the four required prompt fields.
      const promptPatch: UpdateProjectBody = {};
      const promptKeys: (keyof UpdateProjectBody)[] = [
        'name', 'defaultNegative', 'defaultVideoNegative',
        'defaultMotionPrompt', 'defaultStaticMotionPrompt',
      ];
      for (const k of promptKeys) {
        if (draft[k] !== undefined && draft[k] !== project[k as keyof ProjectFull]) {
          (promptPatch as any)[k] = draft[k];
        }
      }
      // settings JSON override: PATCH replaces settings wholesale, so send the
      // full merged object whenever styleLora OR transitionPreset changed.
      // Empty/default values clear the key (falls back to JSON/export default).
      if (styleLora !== initialStyleLora || transitionPreset !== initialTransitionPreset) {
        const base = (project.settings as Record<string, unknown> | null) ?? {};
        const nextSettings = { ...base };
        if (styleLora) nextSettings.styleLora = { name: styleLora };
        else delete nextSettings.styleLora;
        if (transitionPreset === 'comic') nextSettings.transitionPreset = 'comic';
        else delete nextSettings.transitionPreset;
        promptPatch.settings = nextSettings;
      }
      let nextProject = project;
      if (Object.keys(promptPatch).length > 0) {
        nextProject = await api.updateProject(project.id, promptPatch);
      }
      setInitialStyleLora(styleLora);
      setInitialTransitionPreset(transitionPreset);
      // scriptText goes through the separate endpoint (handles null/empty correctly).
      const currentScript = (await api.getProjectScript(project.id)).text ?? '';
      if (scriptText !== currentScript) {
        await api.patchProjectScript(project.id, scriptText);
      }
      setProject(nextProject);
      setDraft({});
      setStatus('saved');
      setTimeout(() => setStatus((s) => s === 'saved' ? 'idle' : s), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  return (
    <main className="px-8 py-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Настройки проекта</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Поля промптов подставляются в воркфлоу при рендере. Меняешь здесь — применяется
            ко всем шотам, у которых нет своего per-shot override.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {status === 'saved' && <span className="text-xs text-emerald-400">сохранено ✓</span>}
          <button
            onClick={save}
            disabled={status === 'saving' || !dirty}
            className="text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-1.5 rounded"
          >
            {status === 'saving' ? '…' : 'сохранить'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}

      <section className="space-y-4">
        <Row label="Название" hint="UI-метка проекта в шапке и списках.">
          <input type="text" value={v('name')} onChange={(e) => onChange('name', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm" />
        </Row>

        {project.visualStyle && project.visualStyle !== 'photoreal_cinematic' && (
          <Row
            label="Стиль (LoRA)"
            hint="project.settings.styleLora — стилевая LoRA, подставляется в ноду 2 (LoraLoader) графnovel-воркфлоу при рендере. «По умолчанию» = LoRA, зашитая в воркфлоу. Файлы берутся из models/loras/style/.">
            <select
              value={styleLora}
              onChange={(e) => setStyleLora(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
              <option value="">По умолчанию (из воркфлоу)</option>
              {styleLora && !styleLoras.some((l) => l.name === styleLora) && (
                <option value={styleLora}>{styleLora} (нет файла на диске)</option>
              )}
              {styleLoras.map((l) => (
                <option key={l.name} value={l.name}>{l.label}</option>
              ))}
            </select>
          </Row>
        )}

        <Row
          label="Переходы между шотами (CapCut)"
          hint="project.settings.transitionPreset — стиль переходов на стыках шотов при экспорте в CapCut. «Стандартный» = ротация 8 бесплатных переходов (затухание, наезды, сдвиги, глитч). «Комикс» = 漫画撕纸 (разрыв с угла) 90% + 便利贴 (стикер) 5% + 故障拼贴 (рваный коллаж) 5%, разложенные по случайным стыкам. Комикс-переходы — VIP (нужен CapCut Pro).">
          <select
            value={transitionPreset}
            onChange={(e) => setTransitionPreset(e.target.value as TransitionPreset)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
            <option value="default">Стандартный (ротация 8 переходов)</option>
            <option value="comic">Комикс (разрыв 90% / стикер 5% / коллаж 5%)</option>
          </select>
        </Row>

        <Row
          label="SDXL Negative (обязательное)"
          hint="Project.defaultNegative — подставляется в SDXL рендер сцены если у шота нет своего pf.negative. Подтягивает санитайзер (weights ≤ 1.3, без motion blur/plastic skin). Пустую строку API отклонит.">
          <textarea value={v('defaultNegative')} rows={4}
            onChange={(e) => onChange('defaultNegative', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed" />
        </Row>

        <Row
          label="Wan2.2 Video Negative (обязательное)"
          hint="Project.defaultVideoNegative — попадает в node 10 i2v воркфлоу. Per-shot override: Shot.promptFields.motionNegative.">
          <textarea value={v('defaultVideoNegative')} rows={4}
            onChange={(e) => onChange('defaultVideoNegative', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed" />
        </Row>

        <Row
          label="Wan2.2 Motion Prompt fallback (обязательное)"
          hint="Project.defaultMotionPrompt — подставляется в node 9 если у VideoRender.motionPrompt пусто и шот не static.">
          <textarea value={v('defaultMotionPrompt')} rows={3}
            onChange={(e) => onChange('defaultMotionPrompt', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed" />
        </Row>

        <Row
          label="Wan2.2 Static-shot fallback (обязательное)"
          hint="Project.defaultStaticMotionPrompt — для шотов с pf.camera.movement начинающимся с 'static'. Должно быть сильное 'freeze frame, no motion' указание.">
          <textarea value={v('defaultStaticMotionPrompt')} rows={5}
            onChange={(e) => onChange('defaultStaticMotionPrompt', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed" />
        </Row>

        <Row
          label="Сценарий (scriptText)"
          hint="Project.scriptText — Markdown-сценарий проекта. Канонический источник для VO, персонажей, локаций. Может быть пустым (необязательное).">
          <textarea value={scriptText} rows={20}
            onChange={(e) => setScriptText(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono leading-relaxed" />
        </Row>
      </section>

      <hr className="border-zinc-800" />

      <ProjectTTSSettings
        projectId={project.id}
        initialEngine={project.ttsEngine ?? null}
        initialVoiceRefPath={project.ttsVoiceRefPath ?? null}
        onProjectUpdated={(p) => setProject((prev) => prev ? { ...prev, ...p } : prev)}
      />
    </main>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">{label}</div>
      {hint && <div className="text-[11px] text-zinc-600 mb-2 leading-snug">{hint}</div>}
      {children}
    </label>
  );
}
