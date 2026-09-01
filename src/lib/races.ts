import type { RaceStatus } from './time';
import type { PublicSnapshot } from './slice';

/**
 * Race config types + validation, shared by the thin server (raceApi.ts)
 * and the browser. Race GENERATION lives client-side (src/lib/clientGen.ts)
 * under the chunk protocol — the server only ever commits seeds, stores
 * chunk strings, and slices by the clock.
 */

/** Summit is the mountain. The Olympics and Mars Run formats are retired. */
export type Theme = 'everest';

export interface CreateRaceInput {
  title?: string;
  theme?: Theme;
  teams: { name: string; color?: string }[];
  durationMs: number;
  startAtMs?: number;
  demo?: boolean;
}

export interface RaceConfigStored {
  title: string;
  theme: Theme;
  teams: { name: string; color?: string }[];
  demo: boolean;
}

export const DURATION_MIN_MS = 60_000;
export const DURATION_MAX_MS = 86_400_000; // 24 hours

export class ValidationError extends Error {}

export function validateCreateInput(
  input: CreateRaceInput,
  nowMs: number,
): { config: RaceConfigStored; durationMs: number; startAtMs: number } {
  if (!input || !Array.isArray(input.teams)) {
    throw new ValidationError('teams must be an array');
  }
  const teams = input.teams.map((t, i) => {
    const name = String(t?.name ?? '').trim();
    if (!name) throw new ValidationError(`team ${i + 1} needs a name`);
    if (name.length > 40) throw new ValidationError(`team name "${name.slice(0, 20)}…" is too long (max 40)`);
    const out: RaceConfigStored['teams'][number] = { name };
    if (t.color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(t.color)) throw new ValidationError('colors must be #rrggbb');
      out.color = t.color;
    }
    return out;
  });
  if (teams.length < 2 || teams.length > 50) {
    throw new ValidationError('between 2 and 50 teams');
  }
  const lower = new Set<string>();
  for (const t of teams) {
    const key = t.name.toLowerCase();
    if (lower.has(key)) throw new ValidationError(`duplicate team name "${t.name}"`);
    lower.add(key);
  }

  const durationMs = Math.round(Number(input.durationMs));
  if (!Number.isFinite(durationMs) || durationMs < DURATION_MIN_MS || durationMs > DURATION_MAX_MS) {
    throw new ValidationError('duration must be between 1 minute and 24 hours');
  }

  const demo = Boolean(input.demo);
  let startAtMs = input.startAtMs === undefined ? nowMs + 60_000 : Math.round(Number(input.startAtMs));
  if (demo) startAtMs = nowMs;
  if (!Number.isFinite(startAtMs)) throw new ValidationError('bad start time');
  if (startAtMs < nowMs - 5_000) throw new ValidationError('start time is in the past');
  if (startAtMs > nowMs + 30 * 24 * 3_600_000) throw new ValidationError('start time is too far out');

  const theme: Theme = input.theme ?? 'everest';
  if (theme !== 'everest') {
    throw new ValidationError('theme must be everest');
  }

  const title = String(input.title ?? '').trim().slice(0, 80) || 'The Expedition';

  return {
    config: { title, theme, teams, demo },
    durationMs,
    startAtMs,
  };
}

/** The client-side view the race page renders from (assembled from chunks). */
export interface RaceView {
  slug: string;
  status: RaceStatus | 'preparing';
  serverNow: number;
  startAt: number;
  durationMs: number;
  config: { title: string; theme: string; demo: boolean; teams: { name: string; color?: string }[] };
  snapshot: PublicSnapshot;
}
