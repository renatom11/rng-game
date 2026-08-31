export type RaceStatus = 'scheduled' | 'running' | 'finished';

export function deriveStatus(
  nowMs: number,
  startAtMs: number,
  durationMs: number,
): RaceStatus {
  if (nowMs < startAtMs) return 'scheduled';
  if (nowMs < startAtMs + durationMs) return 'running';
  return 'finished';
}
