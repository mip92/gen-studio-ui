import { VoVerdictView } from './api';

export const PROSODY_LABELS: Record<string, string> = {
  monotone: 'монотонно', too_fast: 'слишком быстро', too_slow: 'слишком медленно',
  long_mid_silence: 'длинная пауза в середине', clipping: 'клиппинг',
};
export const TECH_LABELS: Record<string, string> = {
  truncated_end: 'обрезан конец', leading_garbage: 'мусор в начале',
  too_short: 'слишком короткий', too_long: 'слишком длинный',
};

/** Полная расшифровка вердикта VO-QC: за что именно сняты баллы — и на pass
 *  тоже (голый «QC ✓ 92» не объяснял недостающие 8, user 2026-08-07). Общая
 *  для /tts и страницы narration; показывается тап-раскрытием, потому что
 *  title-tooltip на планшете не существует (user 2026-08-23). */
export function voVerdictTooltip(v: VoVerdictView): string {
  const lines: string[] = [];
  for (const i of v.issues ?? []) lines.push(i);
  if (typeof v.wer === 'number' && v.wer > 0) lines.push(`расхождение слов с текстом (WER): ${Math.round(v.wer * 100)}%`);
  if (v.missingWords?.length)  lines.push(`не услышано: ${v.missingWords.join(', ')}`);
  if (v.extraWords?.length)    lines.push(`лишнее: ${v.extraWords.join(', ')}`);
  if (v.repeatedWords?.length) lines.push(`заикание/повтор: ${v.repeatedWords.join(', ')}`);
  if (v.garbledWords?.length)  lines.push(`искажено: ${v.garbledWords.map((g) => `${g.expected} → ${g.heard}`).join('; ')}`);
  if (v.prosodyFlags?.length)  lines.push(`просодия: ${v.prosodyFlags.map((f) => PROSODY_LABELS[f] ?? f).join(', ')}`);
  if (v.techFlags?.length)     lines.push(`техника: ${v.techFlags.map((f) => TECH_LABELS[f] ?? f).join(', ')}`);
  if (v.riskyStressWords?.length) lines.push(`омографы (проверить ударение): ${v.riskyStressWords.join(', ')}`);
  if (v.textSnapshotStale) lines.push('⚠ текст кадра изменился после рендера этого дубля');
  if (lines.length === 0) return 'идеальное совпадение с текстом, претензий нет';
  if (v.transcript) lines.push(`распознано: «${v.transcript}»`);
  return lines.join('\n');
}
