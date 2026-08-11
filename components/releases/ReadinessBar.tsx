'use client';

import type { ReleaseItem } from '../../lib/api';

/**
 * Вердикт экспорт-гейта CapCut (ExportsService.checkReadiness): «готов» —
 * ровно когда доступна кнопка экспорта; иначе — чего не хватает (клипы с
 * апскейлом+интерпом, одобренная музыка, пустые акты) + полоса по кадрам.
 */
export function ReadinessBar({ r }: { r: ReleaseItem }) {
  if (r.exportReady === null) return null; // опубликован — гейт не считается
  if (r.exportReady) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-800">
        готов к экспорту
      </span>
    );
  }
  const parts: string[] = [];
  if (r.missingClips)  parts.push(`клипы: ${r.missingClips}`);
  if (r.missingMusic)  parts.push(`музыка: ${r.missingMusic} акт.`);
  if (r.missingScenes) parts.push(`пустых актов: ${r.missingScenes}`);
  const done = Math.max(0, r.totalShots - r.missingClips);
  return (
    <div className="space-y-1 min-w-44">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
          <div className="h-full bg-amber-500 transition-all"
            style={{ width: `${r.totalShots ? (done / r.totalShots) * 100 : 0}%` }} />
        </div>
        <span className="text-[10px] text-zinc-500 font-mono shrink-0">{done}/{r.totalShots}</span>
      </div>
      <div className="text-[10px] text-amber-400/90">{parts.join(' · ') || 'не готов'}</div>
    </div>
  );
}
