'use client';

import { useEffect, useState, use } from 'react';
import { api, ProjectFull, UpdateProjectBody, StyleLoraItem, VisualStyle } from '@/lib/api';
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

/** CapCut export type out of project.settings. 'comic' = film→comic spreads
 *  with camera fly-through + page flips; anything else = the linear export. */
type ExportType = 'linear' | 'comic';
function exportTypeOf(settings: unknown): ExportType {
  const s = (settings as { exportType?: unknown } | null | undefined)?.exportType;
  return s === 'comic' ? 'comic' : 'linear';
}

/** Per-project Flux base UNET (graphic_novel_flux). '' = use the workflow default. */
function fluxBaseOf(settings: unknown): string {
  const s = (settings as { fluxBaseModel?: unknown } | null | undefined)?.fluxBaseModel;
  return typeof s === 'string' ? s : '';
}

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [scriptText, setScriptText] = useState<string>('');
  const [draft, setDraft]   = useState<UpdateProjectBody>({});
  const [status, setStatus] = useState<Status>('loading');
  const [error,  setError]  = useState<string | null>(null);

  // Registry of selectable visual styles (project.visualStyle picker).
  const [visualStyles, setVisualStyles]       = useState<VisualStyle[]>([]);

  // Per-project comic style-LoRA. '' = use the workflow's baked default.
  const [styleLoras, setStyleLoras]           = useState<StyleLoraItem[]>([]);
  const [styleLora, setStyleLora]             = useState<string>('');
  const [initialStyleLora, setInitialStyleLora] = useState<string>('');

  // Shot-boundary transition preset for the CapCut export. '' default rotation
  // vs 'comic' (Comic Tear 90% / Sticker 5% / Glitch Collage 5%).
  const [transitionPreset, setTransitionPreset]             = useState<TransitionPreset>('default');
  const [initialTransitionPreset, setInitialTransitionPreset] = useState<TransitionPreset>('default');

  // Per-project Flux base UNET (graphic_novel_flux only). '' = workflow default.
  const [fluxBase, setFluxBase]               = useState<string>('');
  const [initialFluxBase, setInitialFluxBase] = useState<string>('');

  // CapCut export type: 'linear' (existing simple-transition export) vs 'comic'
  // (film→comic spreads, camera fly-through + page flips).
  const [exportType, setExportType]             = useState<ExportType>('linear');
  const [initialExportType, setInitialExportType] = useState<ExportType>('linear');

  useEffect(() => {
    (async () => {
      try {
        setStatus('loading');
        const [proj, script, loras, styles] = await Promise.all([
          api.getProject(id),
          api.getProjectScript(id),
          api.listStyleLoras().catch(() => [] as StyleLoraItem[]),
          api.listVisualStyles().catch(() => [] as VisualStyle[]),
        ]);
        setProject(proj);
        setScriptText(script.text ?? '');
        setStyleLoras(loras);
        setVisualStyles(styles);
        const cur = styleLoraNameOf(proj.settings);
        setStyleLora(cur);
        setInitialStyleLora(cur);
        const curPreset = transitionPresetOf(proj.settings);
        setTransitionPreset(curPreset);
        setInitialTransitionPreset(curPreset);
        const curBase = fluxBaseOf(proj.settings);
        setFluxBase(curBase);
        setInitialFluxBase(curBase);
        const curExport = exportTypeOf(proj.settings);
        setExportType(curExport);
        setInitialExportType(curExport);
        setStatus('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, [id]);

  if (status === 'loading' || !project) {
    return <main className="px-4 sm:px-8 py-6"><p className="text-zinc-500">Загрузка…</p></main>;
  }

  // Pick the effective value for an input — draft overrides the saved project.
  const v = <K extends keyof UpdateProjectBody>(k: K): string =>
    (draft[k] as string | undefined) ?? (project[k as keyof ProjectFull] as string | null ?? '') as string;

  // Effective visual style (draft override → saved) — drives which style-specific
  // rows (LoRA, Flux base) are shown, live, before the change is even saved.
  const effStyle = (draft.visualStyle as string | undefined) ?? (project.visualStyle ?? 'photoreal_cinematic');
  const STYLE_FALLBACK = [
    { id: 'photoreal_cinematic',       displayName: 'Photoreal cinematic' },
    { id: 'graphic_novel_cell_shaded', displayName: 'Graphic novel (SDXL)' },
    { id: 'graphic_novel_flux',        displayName: 'Graphic novel (Flux)' },
    { id: 'realcomic_qwen',            displayName: 'RealComic (Qwen 2511)' },
  ];
  const styleOpts = visualStyles.length > 0
    ? visualStyles.map((s) => ({ id: s.id, displayName: s.displayName ?? s.id }))
    : STYLE_FALLBACK;

  const dirty =
    Object.keys(draft).length > 0
    || styleLora !== initialStyleLora
    || transitionPreset !== initialTransitionPreset
    || fluxBase !== initialFluxBase
    || exportType !== initialExportType
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
        'name', 'visualStyle', 'defaultNegative', 'defaultVideoNegative',
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
      if (
        styleLora !== initialStyleLora
        || transitionPreset !== initialTransitionPreset
        || fluxBase !== initialFluxBase
        || exportType !== initialExportType
      ) {
        const base = (project.settings as Record<string, unknown> | null) ?? {};
        const nextSettings = { ...base };
        if (styleLora) nextSettings.styleLora = { name: styleLora };
        else delete nextSettings.styleLora;
        if (transitionPreset === 'comic') nextSettings.transitionPreset = 'comic';
        else delete nextSettings.transitionPreset;
        if (fluxBase.trim()) nextSettings.fluxBaseModel = fluxBase.trim();
        else delete nextSettings.fluxBaseModel;
        if (exportType === 'comic') nextSettings.exportType = 'comic';
        else delete nextSettings.exportType;
        promptPatch.settings = nextSettings;
      }
      let nextProject = project;
      if (Object.keys(promptPatch).length > 0) {
        nextProject = await api.updateProject(project.id, promptPatch);
      }
      setInitialStyleLora(styleLora);
      setInitialTransitionPreset(transitionPreset);
      setInitialFluxBase(fluxBase);
      setInitialExportType(exportType);
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
    <main className="px-4 sm:px-8 py-6 max-w-5xl mx-auto space-y-6">
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

        <Row
          label="Визуальный стиль / воркфлоу"
          hint="project.visualStyle — определяет пайплайн рендера (SceneStrategy + воркфлоу + identity). Меняется в любой момент и влияет на БУДУЩИЕ рендеры (уже отрендеренные кадры не трогает). graphic_novel_flux = Flux-комикс; graphic_novel_cell_shaded = SDXL-комикс; photoreal_cinematic = фотореализм.">
          <select
            value={effStyle}
            onChange={(e) => onChange('visualStyle', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
            {styleOpts.map((s) => (
              <option key={s.id} value={s.id}>{s.displayName} — {s.id}</option>
            ))}
            {effStyle && !styleOpts.some((s) => s.id === effStyle) && (
              <option value={effStyle}>{effStyle} (нет в реестре)</option>
            )}
          </select>
        </Row>

        {effStyle !== 'photoreal_cinematic' && (
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

        {effStyle === 'graphic_novel_flux' && (
          <Row
            label="Flux база (UNET)"
            hint="project.settings.fluxBaseModel — имя файла Flux-базы (node 1, models/unet|diffusion_models/). Один раз на проект. Пусто = дефолт из воркфлоу (flux1-dev-kontext). Под комикс-LoRA обычно нужен нейтральный flux1-dev, совпадающий с базой обучения LoRA. Комикс-вид даёт LoRA из поля «Стиль (LoRA)» выше — её файл положи в models/loras/style/.">
            <input
              type="text"
              value={fluxBase}
              onChange={(e) => setFluxBase(e.target.value)}
              placeholder="flux1-dev-kontext_fp8_scaled.safetensors"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono" />
          </Row>
        )}

        <Row
          label="Тип экспорта (CapCut)"
          hint="project.settings.exportType — как собирается CapCut-драфт на шаге «Экспорт в CapCut». «Линейный» = обычная лента шотов с простыми переходами. «Комикс» = фильм раскладывается на страницы-комиксы, камера летает по панелям (кейфреймы) с переворотами страниц. Комикс-экспорт МЕДЛЕННЫЙ (несколько минут) и пишет драфт прямо в папку CapCut — CapCut должен быть закрыт.">
          <select
            value={exportType}
            onChange={(e) => setExportType(e.target.value as ExportType)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm">
            <option value="linear">Линейный (простые переходы)</option>
            <option value="comic">Комикс (камера + переворот страниц)</option>
          </select>
        </Row>

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
        initialVoiceoverId={project.ttsVoiceoverId ?? null}
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
