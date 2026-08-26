'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLiveEvents, on } from '../lib/liveEvents';

type Sample = {
  step:       number;
  totalSteps: number;
  percent:    number;
  avgLoss:    number;
  elapsedSec: number;
  etaSec:     number | null;
  secPerIt:   number;
};


/**
 * Loss curve + step-rate sparkline for a kohya training run. Polls while the
 * run is still active (phase is anything except a terminal status), then stops.
 */
export function TrainingHistoryChart({ jobId }: { jobId: string }) {
  const [data, setData] = useState<{ phase: string; samples: Sample[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Was a self-rescheduling setTimeout chain that stopped on a terminal phase.
  // LoRA training emits a loss sample per step, which the queue does NOT know
  // about — the only queue delta for a training job is start and finish. So the
  // curve now refreshes on those two moments plus every tab wake, not per step.
  // That is the honest tradeoff of dropping the timer: no live-drawing curve
  // while training runs. Nothing in the backend can push per-step progress today
  // (see docs/live-updates.md § «Чего сокет не знает»).
  const load = useCallback(async () => {
    try {
      const r = await api.trainingHistory(jobId, 500);
      setData({ phase: r.phase, samples: r.samples });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const trainMatch = useCallback(on.all(on.job(jobId), on.types('training')), [jobId]);
  const running = !data || !['completed', 'failed', 'cancelled'].includes(data.phase);
  useLiveEvents(trainMatch, load, { active: running });

  if (error) {
    return <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs">{error}</div>;
  }
  if (!data)               return <p className="text-zinc-500 text-sm">Загружаю историю…</p>;
  if (data.samples.length === 0) return <p className="text-zinc-500 text-sm">Лог ещё пустой — kohya не записал ни одного шага.</p>;

  const last = data.samples[data.samples.length - 1];
  const lossSeries = data.samples.map((s) => s.avgLoss);
  const rateSeries = data.samples.map((s) => s.secPerIt);
  const minLoss = Math.min(...lossSeries);
  const maxLoss = Math.max(...lossSeries);
  const avgRate = rateSeries.reduce((a, b) => a + b, 0) / rateSeries.length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <KV label="phase"        value={data.phase} />
        <KV label="step"         value={`${last.step} / ${last.totalSteps}`} />
        <KV label="loss (last)"  value={last.avgLoss.toFixed(4)} />
        <KV label="loss min/max" value={`${minLoss.toFixed(4)} / ${maxLoss.toFixed(4)}`} />
        <KV label="elapsed"      value={fmtHMS(last.elapsedSec)} />
        <KV label="eta"          value={last.etaSec != null ? fmtHMS(last.etaSec) : '—'} />
        <KV label="rate"         value={`${last.secPerIt.toFixed(2)}s/it`} />
        <KV label="avg rate"     value={`${avgRate.toFixed(2)}s/it`} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">avr_loss vs step</div>
        <Chart
          xs={data.samples.map((s) => s.step)}
          ys={lossSeries}
          color="#34d399"
          xLabel="step"
        />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">sec/iter vs step</div>
        <Chart
          xs={data.samples.map((s) => s.step)}
          ys={rateSeries}
          color="#60a5fa"
          xLabel="step"
        />
      </div>

      <p className="text-[10px] text-zinc-600">
        {data.samples.length} точек (decimated to ~500). Источник:
        train.log от последнего тренировочного job этого профиля.
      </p>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-zinc-200 font-mono">{value}</div>
    </div>
  );
}

/**
 * Minimal SVG line chart — no external deps. Pads the value range by 5% so
 * extrema don't sit on the edge. Y-grid lines at 25/50/75% for visual scale.
 */
function Chart({ xs, ys, color, xLabel }: { xs: number[]; ys: number[]; color: string; xLabel?: string }) {
  const W = 800;
  const H = 180;
  const pad = { l: 40, r: 8, t: 8, b: 22 };

  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.05 || Math.abs(yMax) * 0.05 || 1;
  const yLo  = yMin - yPad;
  const yHi  = yMax + yPad;

  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - ((y - yLo) / (yHi - yLo || 1)) * (H - pad.t - pad.b);

  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ');

  // 4 horizontal grid lines (including top + bottom)
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => yLo + (yHi - yLo) * f);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44 bg-zinc-950 rounded border border-zinc-800">
      {gridYs.map((g, i) => (
        <g key={i}>
          <line
            x1={pad.l} x2={W - pad.r}
            y1={sy(g)} y2={sy(g)}
            stroke="#27272a" strokeDasharray={i === 0 || i === gridYs.length - 1 ? undefined : '2 3'}
          />
          <text x={pad.l - 4} y={sy(g) + 3} textAnchor="end" fontSize="9" fill="#71717a" fontFamily="monospace">
            {g.toFixed(g < 1 ? 3 : 1)}
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
      {xLabel && (
        <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="9" fill="#52525b" fontFamily="monospace">
          {xLabel}
        </text>
      )}
      <text x={pad.l} y={H - 4} fontSize="9" fill="#52525b" fontFamily="monospace">
        {xMin}
      </text>
      <text x={W - pad.r - 30} y={H - 4} fontSize="9" fill="#52525b" fontFamily="monospace">
        {xMax}
      </text>
    </svg>
  );
}

function fmtHMS(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
