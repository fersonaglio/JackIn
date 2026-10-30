export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export function parseVttTimestamp(ts: string): number {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  }
  if (parts.length === 2) {
    return (Number(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(parts[0]) || 0;
}

// Parser WebVTT mínimo e tolerante: extrai as cues (start/end/texto) para o
// player desenhar pelo currentTime, sem depender do TextTrack nativo
// (mode/activeCues/srclang), que falha de forma inconsistente ao trocar de faixa.
export function parseVttCues(raw: string): SubtitleCue[] {
  if (!raw) return [];
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const m = lines[timingIdx].match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})/);
    if (!m) continue;
    const body = lines
      .slice(timingIdx + 1)
      .join('\n')
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (body) cues.push({ start: parseVttTimestamp(m[1]), end: parseVttTimestamp(m[2]), text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
