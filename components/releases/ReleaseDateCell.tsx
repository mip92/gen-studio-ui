'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

/**
 * Дата релиза НЕопубликованного проекта: текст «вт 11.08 13:00» + карандаш →
 * <input type="datetime-local"> (значение в локальном времени зрителя,
 * на сервер уходит ISO-instant с зоной). 409 от бэка (занятый слот /
 * опубликованный проект) показывается инлайн-ошибкой, не alert().
 */
export function ReleaseDateCell({
  idOrSlug,
  releaseAt,
  onSaved,
}: {
  idOrSlug: string;
  releaseAt: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const startEdit = () => {
    setValue(toLocalInput(releaseAt ? new Date(releaseAt) : nextTuesday16()));
    setError(null);
    setEditing(true);
  };

  const save = async (iso: string | null) => {
    setBusy(true); setError(null);
    try {
      await api.setReleaseDate(idOrSlug, iso);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(shortError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className={releaseAt ? 'text-zinc-200' : 'text-zinc-600'}>
          {releaseAt ? fmt(new Date(releaseAt)) : 'не запланирован'}
        </span>
        <button type="button" onClick={startEdit} className="text-zinc-500 hover:text-zinc-200 text-xs" title="Изменить дату">✎</button>
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[11px]"
      />
      <button type="button" disabled={busy || !value}
        onClick={() => save(new Date(value).toISOString())}
        className="px-2 py-1 rounded text-[11px] bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
        сохранить
      </button>
      {releaseAt && (
        <button type="button" disabled={busy} onClick={() => save(null)}
          className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50">
          снять дату
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setEditing(false)}
        className="px-1.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300">✕</button>
      {error && <span className="basis-full text-[11px] text-red-400">{error}</span>}
    </div>
  );
}

export function fmt(d: Date): string {
  return d.toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Дефолт для пустого поля: ближайший вторник 16:00 локального времени
 *  (фактическое время публикаций канала). */
function nextTuesday16(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
  d.setHours(16, 0, 0, 0);
  return d;
}

/** Из «409 Conflict: {json}» достаём человеческое message, если оно там есть. */
function shortError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /"message":"([^"]+)"/.exec(raw);
  return m ? m[1] : raw.slice(0, 120);
}
