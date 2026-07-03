'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Waveform trimmer. Loads `src` (a server-hosted audio URL so it works from any
 * LAN device incl. tablets), draws it with wavesurfer.js, and exposes a single
 * draggable region. Trimming itself happens on the server — this widget only
 * reports the chosen [startMs, endMs] up via `onChange`. Coarse selection is by
 * dragging the region edges (touch-friendly); the ± nudge buttons give precise
 * control without needing a fine pointer.
 *
 * wavesurfer touches `window`, so it is imported dynamically inside the effect
 * (never at module scope) to stay clear of SSR.
 */
type Props = {
  src: string;
  initialStartMs?: number | null;
  initialEndMs?: number | null;
  onChange: (startMs: number, endMs: number) => void;
  disabled?: boolean;
};

const MIN_LEN_S = 0.3;
const DEFAULT_LEN_S = 12;

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function AudioTrimmer({ src, initialStartMs, initialEndMs, onChange, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef        = useRef<any>(null);
  const regionRef    = useRef<any>(null);
  const onChangeRef  = useRef(onChange);
  onChangeRef.current = onChange;

  const [ready, setReady]     = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur]         = useState(0);
  const [sel, setSel]         = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  useEffect(() => {
    let cancelled = false;
    let ws: any = null;
    setReady(false); setErr(null); setPlaying(false);

    (async () => {
      try {
        const WaveSurfer    = (await import('wavesurfer.js')).default;
        const RegionsPlugin = (await import('wavesurfer.js/dist/plugins/regions.esm.js')).default;
        if (cancelled || !containerRef.current) return;

        const regions = RegionsPlugin.create();
        ws = WaveSurfer.create({
          container:     containerRef.current,
          height:        96,
          waveColor:     '#3f3f46',
          progressColor: '#10b981',
          cursorColor:   '#e4e4e7',
          normalize:     true,
          plugins:       [regions],
        });
        wsRef.current = ws;

        const publish = (start: number, end: number) => {
          setSel({ start, end });
          onChangeRef.current(Math.round(start * 1000), Math.round(end * 1000));
        };

        ws.on('decode', () => {
          const d = ws.getDuration();
          setDur(d);
          const startS = initialStartMs != null ? initialStartMs / 1000 : 0;
          const endS   = initialEndMs != null ? initialEndMs / 1000 : Math.min(d, startS + DEFAULT_LEN_S);
          const start  = Math.max(0, Math.min(startS, Math.max(0, d - MIN_LEN_S)));
          const end    = Math.max(start + MIN_LEN_S, Math.min(endS, d));
          const region = regions.addRegion({
            start, end, drag: true, resize: true, color: 'rgba(16,185,129,0.18)',
          });
          regionRef.current = region;
          publish(region.start, region.end);
        });

        regions.on('region-updated', (region: any) => {
          regionRef.current = region;
          publish(region.start, region.end);
        });

        ws.on('ready',       () => { if (!cancelled) setReady(true); });
        ws.on('play',        () => setPlaying(true));
        ws.on('pause',       () => setPlaying(false));
        ws.on('finish',      () => setPlaying(false));
        ws.on('timeupdate',  (t: number) => {
          const r = regionRef.current;
          if (r && ws.isPlaying() && t >= r.end) ws.pause();
        });
        ws.on('error', (e: any) => { if (!cancelled) setErr(String(e?.message || e)); });

        await ws.load(src);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
      try { ws?.destroy(); } catch { /* noop */ }
      wsRef.current = null;
      regionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const applyRegion = (start: number, end: number) => {
    const d = dur || 0;
    let s = Math.max(0, start);
    let e = d ? Math.min(end, d) : end;
    if (e - s < MIN_LEN_S) return;                 // refuse a degenerate selection
    const r = regionRef.current;
    if (!r) return;
    r.setOptions({ start: s, end: e });
    setSel({ start: s, end: e });
    onChangeRef.current(Math.round(s * 1000), Math.round(e * 1000));
  };

  const nudge = (edge: 'start' | 'end', delta: number) =>
    edge === 'start' ? applyRegion(sel.start + delta, sel.end) : applyRegion(sel.start, sel.end + delta);

  const playSelection = () => {
    const ws = wsRef.current, r = regionRef.current;
    if (!ws || !r) return;
    if (ws.isPlaying()) { ws.pause(); return; }
    ws.setTime(r.start);
    ws.play();
  };

  const len = Math.max(0, sel.end - sel.start);
  const lenOk = len >= 6 && len <= 15;

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full rounded bg-zinc-950 border border-zinc-800 min-h-[96px]" />
      {err && <p className="text-red-300 text-xs font-mono">Ошибка загрузки аудио: {err}</p>}
      {!ready && !err && <p className="text-zinc-500 text-xs">Загрузка волны…</p>}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={playSelection} disabled={disabled || !ready}
          className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-40">
          {playing ? '⏸ Пауза' : '▶ Прослушать выделение'}
        </button>
        <span className="font-mono text-xs text-zinc-400">
          {fmt(sel.start)} – {fmt(sel.end)} ·{' '}
          <span className={lenOk ? 'text-emerald-400' : 'text-amber-400'}>{len.toFixed(1)}s</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <NudgeRow label="Начало" onNudge={(d) => nudge('start', d)} disabled={disabled || !ready} />
        <NudgeRow label="Конец"  onNudge={(d) => nudge('end', d)}  disabled={disabled || !ready} />
      </div>

      <p className="text-[11px] text-zinc-600">
        Тяни края выделения на волне или подстраивай кнопками. Рекомендуемая длина примера голоса — 6–15 секунд.
      </p>
    </div>
  );
}

function NudgeRow({ label, onNudge, disabled }: { label: string; onNudge: (deltaSec: number) => void; disabled?: boolean }) {
  const btn = 'px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono disabled:opacity-40 flex-1';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="flex gap-1">
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(-1)}>−1s</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(-0.1)}>−0.1</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(0.1)}>+0.1</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(1)}>+1s</button>
      </div>
    </div>
  );
}
