'use client';

import { useEffect, useState, use } from 'react';
import { api, ProjectFull, UpdateProjectBody } from '@/lib/api';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [scriptText, setScriptText] = useState<string>('');
  const [draft, setDraft]   = useState<UpdateProjectBody>({});
  const [status, setStatus] = useState<Status>('loading');
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStatus('loading');
        const [proj, script] = await Promise.all([
          api.getProject(id),
          api.getProjectScript(id),
        ]);
        setProject(proj);
        setScriptText(script.text ?? '');
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
    Object.keys(draft).length > 0 || scriptText !== (project ? '' : '') /* always allow script save */;

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
      let nextProject = project;
      if (Object.keys(promptPatch).length > 0) {
        nextProject = await api.updateProject(project.id, promptPatch);
      }
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
