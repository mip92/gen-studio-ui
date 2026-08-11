'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

/**
 * Авто-план: раскладывает выбранные проекты (в порядке, заданном на странице)
 * по свободным слотам. Дефолт — сетка канала: вт/чт, 16:00, старт «с завтра».
 * Оверлей/карточка — по образцу AddVoiceModal.
 */
const WEEKDAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'пн' }, { iso: 2, label: 'вт' }, { iso: 3, label: 'ср' },
  { iso: 4, label: 'чт' }, { iso: 5, label: 'пт' }, { iso: 6, label: 'сб' }, { iso: 7, label: 'вс' },
];

export function AutoPlanModal({
  order,
  names,
  onClose,
  onPlanned,
}: {
  /** id проектов в желаемом порядке релизов (чередование задаётся здесь). */
  order: string[];
  names: Map<string, string>;
  onClose: () => void;
  onPlanned: () => void;
}) {
  const [days, setDays]           = useState<number[]>([2, 4]);
  const [hour, setHour]           = useState(16);
  const [startFrom, setStartFrom] = useState('');
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const toggleDay = (iso: number) =>
    setDays((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()));

  const submit = async () => {
    if (!days.length || busy) return;
    setBusy(true); setError(null);
    try {
      await api.autoPlanReleases(order, {
        days,
        hour,
        startFrom: startFrom ? new Date(startFrom).toISOString() : undefined,
      });
      onPlanned();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Расставить по слотам</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm">
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Порядок ({order.length}):</div>
            <ol className="list-decimal list-inside text-zinc-300 text-xs space-y-0.5 max-h-40 overflow-y-auto">
              {order.map((id) => <li key={id}>{names.get(id) ?? id}</li>)}
            </ol>
          </div>

          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Дни недели (сетка канала — вт/чт):</div>
            <div className="flex gap-1">
              {WEEKDAYS.map((w) => (
                <button key={w.iso} type="button" onClick={() => toggleDay(w.iso)}
                  className={`px-2 py-1 rounded text-xs border ${
                    days.includes(w.iso)
                      ? 'bg-blue-700 border-blue-600 text-white'
                      : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[11px] text-zinc-500">Час:
              <input type="number" min={0} max={23} value={hour}
                onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="ml-2 w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-200" />
            </label>
            <label className="text-[11px] text-zinc-500">Не раньше:
              <input type="date" value={startFrom} onChange={(e) => setStartFrom(e.target.value)}
                className="ml-2 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-200" />
            </label>
          </div>

          {error && <div className="text-[11px] text-red-400">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Отмена</button>
          <button type="button" onClick={submit} disabled={busy || !days.length || !order.length}
            className="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
            {busy ? 'Раскладываю…' : 'Расставить'}
          </button>
        </div>
      </div>
    </div>
  );
}
