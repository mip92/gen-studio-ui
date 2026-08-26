'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ShotFull, VideoFlow } from '../lib/api';
import { BreadcrumbItem } from './Breadcrumbs';
import { PageHeader } from './PageHeader';

type CharactersList = Awaited<ReturnType<typeof api.listCharacters>>;

interface ShotCtx {
  shot:        ShotFull;
  setShot:     (s: ShotFull) => void;
  reload:      () => Promise<void>;
  characters:  CharactersList;
  projectId:   string;
  shotId:      string;
}

const ShotContext = createContext<ShotCtx | null>(null);

export function useShotCtx(): ShotCtx {
  const ctx = useContext(ShotContext);
  if (!ctx) throw new Error('useShotCtx must be used inside <ShotPageShell>');
  return ctx;
}

/**
 * The flow this shot actually renders on: `shot → act → project`, the same
 * COALESCE `VideoRenderService.resolveVideoFlow()` runs in SQL. Both defaults
 * ride along on the shot payload, so nothing here costs a request.
 *
 * `own` is the shot's own column — null means «наследовать», and that is a
 * distinct UI state from an explicit 'i2v', because storing the resolved value
 * would silently pin the shot the next time the act is switched.
 */
export function resolveVideoFlow(shot: ShotFull): {
  own: VideoFlow | null; inherited: VideoFlow; effective: VideoFlow;
} {
  const own = (shot.videoFlow ?? null) as VideoFlow | null;
  const inherited = (shot.scene?.defaultVideoFlow
    ?? shot.project?.defaultVideoFlow
    ?? 'i2v') as VideoFlow;
  return { own, inherited, effective: own ?? inherited };
}

const TABS = [
  { slug: 'prompts',      label: 'Промпты' },
  { slug: 'participants', label: 'Участники' },
  { slug: 'render',       label: 'Рендер' },
  // Sits between the still and the clip because that is where it belongs in the
  // pipeline: on the two-frame flow the end frame is the clip's second input.
  { slug: 'end-frame',    label: 'Посл. кадр' },
  { slug: 'videos',       label: 'Видео' },
  { slug: 'narration',    label: 'Озвучка' },
] as const;

export function ShotPageShell({
  projectId, shotId, children,
}: {
  projectId: string; shotId: string; children: React.ReactNode;
}) {
  const [shot,       setShot]       = useState<ShotFull | null>(null);
  const [characters, setCharacters] = useState<CharactersList>([]);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, chs] = await Promise.all([api.getShot(shotId), api.listCharacters(projectId)]);
      setShot(s);
      setCharacters(chs);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [shotId, projectId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <main className="px-4 sm:px-8 py-6">
        <div className="bg-red-900/40 border border-red-700 rounded p-4 text-red-200 font-mono text-sm">{error}</div>
      </main>
    );
  }
  if (!shot) {
    return <main className="px-4 sm:px-8 py-6 text-zinc-500">Loading…</main>;
  }

  return (
    <ShotContext.Provider value={{ shot, setShot, reload: load, characters, projectId, shotId }}>
      <StickyHeader projectId={projectId} shotId={shotId} shot={shot} />
      {children}
    </ShotContext.Provider>
  );
}

function StickyHeader({ projectId, shotId, shot }: { projectId: string; shotId: string; shot: ShotFull }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/shots/${shotId}`;
  const activeSlug = TABS.find((t) => pathname?.includes(`${base}/${t.slug}`))?.slug ?? '';
  const tab = TABS.find((t) => t.slug === activeSlug);

  // shot is always loaded by the time we reach the StickyHeader — error/loading
  // states bail out earlier — so we never have to fall back to a truncated id.
  const crumbs: BreadcrumbItem[] = [
    { label: 'Overview',                  href: '/' },
    { label: 'Projects',                  href: '/projects' },
    { label: shot.project?.name ?? '…',   href: `/projects/${projectId}` },
    { label: shot.scene?.title ?? shot.scene?.sceneKey ?? 'scene',
      href: `/projects/${projectId}/scenes#${shot.scene?.sceneKey ?? ''}` },
    { label: shot.shotCode,       href: `${base}/prompts` },
    ...(tab ? [{ label: tab.label }] : []),
  ];

  // Static shots never get a video clip — the backend rejects video generation
  // for them with a 400, so disable the tab outright instead of letting the
  // user click through to a dead end.
  const isStatic = shot.renderMode === 'static';
  // Same reasoning one level down: on the one-frame flow nothing downstream ever
  // reads an end frame, so the tab that authors one is a dead end too.
  const oneFrame = resolveVideoFlow(shot).effective === 'i2v';
  // …and the mirror case: a two-frame shot whose second picture is not APPROVED
  // yet cannot render a clip worth having. The backend answers such a request in
  // one of two unhelpful ways — a silent degrade to one frame when nothing is
  // picked, a 400 when something is picked but unapproved — and both look like a
  // failed two-frame clip afterwards. So the clip tab waits for the pair.
  // `endFrameApprovedAt` covers both states: choosing always clears it.
  //
  // Existing clips keep the tab open. The soft degrade shipped one-frame clips on
  // flf2v shots for days before the pair became a rule, and greying the tab out
  // would have hidden them — with no way to watch or approve what is already on
  // disk. The render button inside the tab stays blocked either way.
  const awaitsEndFrame = !oneFrame && !shot.endFrameApprovedAt
    && (shot.videoRenders?.length ?? 0) === 0;

  return (
    <PageHeader
      crumbs={crumbs}
      title={<span className="font-mono">{shot.shotCode}</span>}
      actions={<><RenderModeToggle /><VideoFlowToggle /></>}
      tabs={TABS.map((t) => {
        // A static shot never becomes a clip, so neither the clip nor its second
        // conditioning frame means anything for it.
        const staticBlocked = (t.slug === 'videos' || t.slug === 'end-frame') && isStatic;
        // Checked after the static case so a static shot keeps the more basic
        // explanation — being static is why it has no clip at all.
        const flowBlocked   = t.slug === 'end-frame' && !staticBlocked && oneFrame;
        const pairBlocked   = t.slug === 'videos'    && !staticBlocked && awaitsEndFrame;
        return {
          href:     `${base}/${t.slug}`,
          label:    t.label,
          active:   activeSlug === t.slug,
          disabled: staticBlocked || flowBlocked || pairBlocked,
          title:    staticBlocked
            ? 'Недоступно для статичного кадра (renderMode=static)'
            : flowBlocked
              ? 'Кадр едет на ОДНОМ опорном кадре (флоу i2v) — последний кадр ему не нужен. '
                + 'Переключи «Флоу» на «2 кадра» здесь, в шапке, у акта или у проекта.'
              : pairBlocked
                ? (shot.chosenEndFrame
                    ? 'Последний кадр выбран, но НЕ утверждён — рендер откажет. '
                      + 'Утверди его на вкладке «Посл. кадр».'
                    : 'Кадр едет на ДВУХ опорных кадрах, а последнего ещё нет — клип уехал бы '
                      + 'по одному. Сделай и утверди его на вкладке «Посл. кадр».')
                : undefined,
        };
      })}
    />
  );
}

/**
 * Per-shot render-mode override. Acts can be bulk-set static/animated, but this
 * lets a single shot be flipped independently: 'animated' → Wan i2v clip,
 * 'static' → still only (video generation disabled, Ken Burns in export). The
 * Видео tab greys out immediately because TabsNav reads shot.renderMode.
 */
function RenderModeToggle() {
  const { shot, setShot, shotId } = useShotCtx();
  const [busy, setBusy] = useState(false);
  const isStatic = shot.renderMode === 'static';

  const set = async (mode: 'animated' | 'static') => {
    if (busy || (mode === 'static') === isStatic) return;
    setBusy(true);
    try {
      const updated = await api.updateShot(shotId, { renderMode: mode });
      setShot(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const base = 'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';
  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* On a phone this toggle sits in the sticky header next to the shot-code
          title; at full width (~280px) it starved the title into overlapping.
          Below sm the word labels collapse to the emoji alone. */}
      <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-zinc-500">Режим</span>
      <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="group"
           title="Переопределяет режим рендера для этого кадра, независимо от акта">
        <button type="button" disabled={busy} onClick={() => set('animated')}
                className={`${base} ${!isStatic ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
          🎬<span className="hidden sm:inline"> С видео</span>
        </button>
        <button type="button" disabled={busy} onClick={() => set('static')}
                className={`${base} border-l border-zinc-700 ${isStatic ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
          🖼<span className="hidden sm:inline"> Статичный</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Per-shot video-flow override, sitting next to the render-mode toggle because
 * it answers the very next question: this shot IS animated — on one conditioning
 * frame or two? It lives in the header rather than only inside the «Посл. кадр»
 * tab so the answer is visible while writing the prompts, which is where it
 * matters: the two flows want DIFFERENT motion prompts (i2v = Motion + Camera,
 * flf2v = PATH + Camera — Skill(gen-studio-wan22) §8a), and a text written for
 * the wrong one buys a morph instead of a movement.
 *
 * Three states, unlike render mode: «Наследовать» is null, i.e. the act decides
 * and failing that the project. Storing the resolved value instead would
 * silently pin the shot the next time the act is switched. Because null hides
 * what actually happens, the inherited option is outlined rather than filled —
 * so the header always shows which flow this shot really renders on.
 */
export function VideoFlowToggle() {
  const { shot, setShot, shotId } = useShotCtx();
  const [busy, setBusy] = useState(false);

  const { own, inherited, effective } = resolveVideoFlow(shot);

  // A static shot never becomes a clip, so neither flow means anything for it —
  // the backend refuses video generation outright. Mirrors the disabled tabs.
  const isStatic = shot.renderMode === 'static';

  const set = async (v: VideoFlow | null) => {
    if (busy || v === own) return;
    setBusy(true);
    try {
      const updated = await api.updateShot(shotId, { videoFlow: v });
      setShot(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const opts: Array<{ v: VideoFlow | null; icon: string; label: string; active: string }> = [
    { v: null,    icon: '↳',  label: 'Наследовать', active: 'bg-blue-600 text-white'    },
    { v: 'i2v',   icon: '1️⃣', label: '1 кадр',      active: 'bg-blue-600 text-white'    },
    { v: 'flf2v', icon: '2️⃣', label: '2 кадра',     active: 'bg-emerald-600 text-white' },
  ];
  const base = 'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50';
  const title = isStatic
    ? 'Статичный кадр не становится клипом — флоу для него ничего не решает'
    : `Клип едет на ${effective === 'flf2v' ? 'ДВУХ опорных кадрах' : 'ОДНОМ опорном кадре'}`
      + `${own === null ? ' (наследовано от акта или проекта)' : ' (задано у кадра)'}`
      + '. Флоу меняет и диалект моушен-промпта: 1 кадр — движение, 2 кадра — путь между кадрами.';

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Same responsive collapse as the render-mode toggle: below sm only the
          icons survive, or the two groups starve the shot-code title. */}
      <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-zinc-500">Флоу</span>
      <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="group" title={title}>
        {opts.map((o, i) => {
          const selected = own === o.v;
          // The inherited option is what actually renders — outline it so
          // «Наследовать» is never a blank cheque.
          const inheritedHint = own === null && o.v === inherited;
          return (
            <button key={String(o.v)} type="button" disabled={busy || isStatic} onClick={() => set(o.v)}
                    className={`${base} ${i > 0 ? 'border-l border-zinc-700 ' : ''}${
                      selected       ? o.active
                      : inheritedHint ? 'bg-zinc-900 text-blue-300 ring-1 ring-inset ring-blue-700/60'
                                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
              {o.icon}<span className="hidden sm:inline"> {o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
