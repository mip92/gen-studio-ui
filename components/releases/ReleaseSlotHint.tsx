'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ReleaseSlot } from '../../lib/api';

/**
 * Подсказка релизного календаря на страницах экспорта и заливки: «по календарю —
 * вт, 18 ноя, 16:00». Если сегодня не день слота — жёлтое предупреждение
 * (информационное, ничего не блокирует: график — инструмент, а не начальник).
 */
export function ReleaseSlotHint({ idOrSlug }: { idOrSlug: string }) {
  const [slot, setSlot] = useState<ReleaseSlot | null>(null);

  useEffect(() => {
    let alive = true;
    api.getReleaseSlot(idOrSlug).then((s) => { if (alive) setSlot(s); }).catch(() => {});
    return () => { alive = false; };
  }, [idOrSlug]);

  if (!slot) return null;

  if (!slot.releaseAt) {
    return (
      <div className="mb-4 text-[11px] text-zinc-500">
        В <Link href="/releases" className="text-blue-400 hover:underline">календаре релизов</Link> у этого фильма нет даты.
      </div>
    );
  }

  const at = new Date(slot.releaseAt);
  const when = at.toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === new Date().toDateString();

  return (
    <div className="mb-4 space-y-1">
      <div className="text-[11px] text-zinc-400">
        📅 По <Link href="/releases" className="text-blue-400 hover:underline">календарю</Link>:{' '}
        <span className="text-zinc-200">{when}</span>
        {slot.published && <span className="ml-1 text-red-400">— уже на канале</span>}
        {slot.uploaded && !slot.published && <span className="ml-1 text-blue-400">— залито, публикация отложена</span>}
      </div>
      {!slot.uploaded && !sameDay && (
        <div className="text-[11px] text-amber-400">
          Сегодня не день этого релиза — если заливаешь сейчас, поставь на YouTube отложенную публикацию на слот (или подвинь дату в календаре).
        </div>
      )}
    </div>
  );
}
