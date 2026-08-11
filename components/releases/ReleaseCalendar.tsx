'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import ruLocale from '@fullcalendar/core/locales/ru';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import { api, type ReleaseItem } from '../../lib/api';

/**
 * Месячная сетка релизов на FullCalendar (тёмная тема — CSS-переменные в
 * globals.css). Цвета: красный = вышел (не двигается), зелёный = план и готов
 * к экспорту, янтарный = план, но экспорт-гейт ещё не пройден.
 *
 * Два способа править дату: drag-and-drop в пределах видимой сетки (время
 * сохраняется) и КЛИК по карточке — мини-редактор с точным вводом даты/времени
 * (для переносов на другие месяцы) и «снять дату». Вышедшим клик открывает
 * только ссылки. Бэкенд отвечает 409 на занятый слот.
 */
export function ReleaseCalendar({
  rows,
  onChanged,
  unscheduleRef,
}: {
  rows: ReleaseItem[];
  onChanged: () => void;
  /** Зона «Не запланировано»: карточка, брошенная на неё, снимает дату. */
  unscheduleRef?: React.RefObject<HTMLElement | null>;
}) {
  const [dropError, setDropError] = useState<string | null>(null);
  const [edit, setEdit]           = useState<ReleaseItem | null>(null);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const events = useMemo(
    () =>
      rows
        .filter((r) => r.releaseAt)
        .map((r) => ({
          id: r.id,
          title: r.name,
          start: r.releaseAt!,
          editable: !r.uploaded,
          classNames: [
            r.published ? 'rel-published'
              : r.uploaded ? 'rel-scheduled' // залито, публикация отложена — датой владеет YouTube
              : r.exportReady ? 'rel-ready' : 'rel-pending',
          ],
        })),
    [rows],
  );

  const onDrop = async (info: EventDropArg) => {
    setDropError(null);
    try {
      await api.setReleaseDate(info.event.id, info.event.start!.toISOString());
      onChanged();
    } catch (e) {
      info.revert();
      setDropError(humanError(e));
    }
  };

  /** Внешний drag из «Не запланировано»: день берём из дропа, время — слот 16:00. */
  const onReceive = async (info: EventReceiveArg) => {
    setDropError(null);
    const at = new Date(info.event.start!);
    at.setHours(16, 0, 0, 0);
    info.event.remove(); // временное событие FC — настоящая карточка придёт из reload
    try {
      await api.setReleaseDate(info.event.id, at.toISOString());
      onChanged();
    } catch (e) {
      setDropError(humanError(e));
    }
  };

  /** Карточка, брошенная на зону «Не запланировано», снимает дату. */
  const onDragStop = async (info: EventDragStopArg) => {
    const zone = unscheduleRef?.current;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const { clientX: x, clientY: y } = info.jsEvent;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    setDropError(null);
    try {
      await api.setReleaseDate(info.event.id, null);
      onChanged();
    } catch (e) {
      setDropError(humanError(e));
    }
  };

  return (
    <div className="release-calendar bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      {dropError && <div className="mb-2 text-[11px] text-red-400">{dropError}</div>}
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={ruLocale}
        firstDay={1}
        height="auto"
        fixedWeekCount={false}
        dayMaxEventRows={3}
        events={events}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        droppable
        eventReceive={onReceive}
        eventDrop={onDrop}
        eventDragStop={onDragStop}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          const r = byId.get(info.event.id);
          if (r) setEdit(r);
        }}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
      />
      {edit && (
        <EventEditor r={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); onChanged(); }} />
      )}
    </div>
  );
}

/** Мини-редактор по клику на карточку: точная дата/время (переносы на любой
 *  месяц), «снять дату», ссылки на проект и видео. */
function EventEditor({ r, onClose, onChanged }: { r: ReleaseItem; onClose: () => void; onChanged: () => void }) {
  const [value, setValue] = useState(() => toLocalInput(new Date(r.releaseAt!)));
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (iso: string | null) => {
    setBusy(true); setError(null);
    try {
      await api.setReleaseDate(r.id, iso);
      onChanged();
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-sm max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100 truncate">{r.name}</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 shrink-0">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          {r.uploaded ? (
            <p className="text-xs text-zinc-400">
              {r.published
                ? 'Уже на канале — дата является фактом публикации и синхронизируется с YouTube.'
                : 'Залито на YouTube, публикация отложена — датой управляет расписание YouTube, здесь она только отображается (обновляется «Сверить с YouTube»).'}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
              />
              <button type="button" disabled={busy || !value}
                onClick={() => save(new Date(value).toISOString())}
                className="px-2.5 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
                Сохранить
              </button>
            </div>
          )}
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          <div className="flex items-center gap-3 text-xs">
            <Link href={`/projects/${r.id}`} className="text-blue-400 hover:underline" onClick={onClose}>
              Открыть проект →
            </Link>
            {r.youtubeUrl && (
              <a href={r.youtubeUrl} target="_blank" rel="noreferrer" className="text-red-400 hover:underline">
                ▶ на YouTube
              </a>
            )}
          </div>
        </div>
        {!r.uploaded && (
          <div className="flex justify-between border-t border-zinc-800 px-5 py-3">
            <button type="button" disabled={busy} onClick={() => save(null)}
              className="px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50">
              Снять дату
            </button>
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-xs text-zinc-500 hover:text-zinc-300">
              Закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Из «409 Conflict: {json}» достаём человеческое message, если оно там есть. */
function humanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return /"message":"([^"]+)"/.exec(raw)?.[1] ?? raw.slice(0, 120);
}
