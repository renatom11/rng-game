import crypto from 'node:crypto';
import { getStorage } from './storage';
import { deriveStatus, type RaceStatus } from './time';
import {
  toJourneySnapshot,
  toOlympicsSnapshot,
  type PublicSnapshot,
} from './slice';
import { generateEverest } from '@/themes/everest/generate';
import type { EverestTimeline, Style } from '@/themes/everest/types';
import { generateOlympics } from '@/themes/olympics/generate';
import type { OlympicsTimeline } from '@/themes/olympics/types';
import { generateSpace } from '@/themes/space/generate';
import { decodeRaceCode, encodeRaceCode } from './raceCode';

/** Slug alphabet without lookalikes (no 0/O/1/l/i/u). */
const SLUG_CHARS = 'abcdefghjkmnpqrstvwxyz23456789';

function newSlug(): string {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += SLUG_CHARS[b % SLUG_CHARS.length];
  return out;
}

export type Theme = 'everest' | 'olympics' | 'space';

export interface CreateRaceInput {
  title?: string;
  theme?: Theme;
  teams: { name: string; color?: string; style?: Style }[];
  durationMs: number;
  startAtMs?: number;
  demo?: boolean;
}

export interface RaceConfigStored {
  title: string;
  theme: Theme;
  teams: { name: string; color?: string; style?: Style }[];
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
    if (t.style !== undefined) {
      if (!['bold', 'balanced', 'cautious'].includes(t.style)) throw new ValidationError('style must be bold, balanced, or cautious');
      out.style = t.style;
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
  if (theme !== 'everest' && theme !== 'olympics' && theme !== 'space') {
    throw new ValidationError('theme must be everest, olympics, or space');
  }

  const title =
    String(input.title ?? '').trim().slice(0, 80) ||
    (theme === 'olympics'
      ? 'The Games'
      : theme === 'space'
        ? 'The Mars Run'
        : 'The Expedition');

  return {
    config: { title, theme, teams, demo },
    durationMs,
    startAtMs,
  };
}

function generateTimeline(
  theme: Theme,
  seed: string,
  teams: RaceConfigStored['teams'],
  durationMs: number,
) {
  return theme === 'olympics'
    ? generateOlympics(seed, { teams, durationMs })
    : theme === 'space'
      ? generateSpace(seed, { teams, durationMs })
      : generateEverest(seed, { teams, durationMs });
}

export async function createRace(
  input: CreateRaceInput,
  nowMs: number,
): Promise<{ slug: string; recoveryCode: string }> {
  const { config, durationMs, startAtMs } = validateCreateInput(input, nowMs);
  const seed = crypto.randomBytes(16).toString('hex');
  const timeline = generateTimeline(config.theme, seed, config.teams, durationMs);
  const slug = newSlug();
  await (await getStorage()).insert({
    id: slug,
    theme: config.theme,
    seed,
    config_json: JSON.stringify(config),
    timeline_json: JSON.stringify(timeline),
    created_at: nowMs,
    start_at: startAtMs,
    duration_ms: durationMs,
  });
  const recoveryCode = encodeRaceCode({
    v: 1,
    slug,
    seed,
    theme: config.theme,
    title: config.title,
    teams: config.teams,
    durationMs,
    startAtMs,
    demo: config.demo,
    createdAt: nowMs,
  });
  return { slug, recoveryCode };
}

/**
 * Rebuild a race from a recovery code — same seed, same config, same start
 * time, same slug (so already-shared links work again on this server).
 * Deterministic regeneration means the restored race is the race: identical
 * outcome, identical story, picked up at exactly the right point in time.
 * Idempotent: restoring a race that already exists is a no-op.
 */
export async function restoreRace(
  code: string,
  nowMs: number,
): Promise<{ slug: string; existed: boolean }> {
  const p = decodeRaceCode(code);
  const storage = await getStorage();
  // Existence check FIRST — regeneration is ~100ms of CPU, and restore is
  // unauthenticated; a known code must never trigger repeated generation.
  if (await storage.exists(p.slug)) return { slug: p.slug, existed: true };

  // Re-validate the embedded config with the code's own start time as "now"
  // — a restored race is allowed (expected!) to have started in the past.
  const { config, durationMs, startAtMs } = validateCreateInput(
    {
      title: p.title,
      theme: p.theme,
      teams: p.teams,
      durationMs: p.durationMs,
      startAtMs: p.startAtMs,
      demo: p.demo,
    },
    p.startAtMs,
  );
  const timeline = generateTimeline(config.theme, p.seed, config.teams, durationMs);
  await storage.insert({
    id: p.slug,
    theme: config.theme,
    seed: p.seed,
    config_json: JSON.stringify(config),
    timeline_json: JSON.stringify(timeline),
    created_at: p.createdAt ?? nowMs,
    start_at: startAtMs,
    duration_ms: durationMs,
  });
  return { slug: p.slug, existed: false };
}

export interface RaceView {
  slug: string;
  status: RaceStatus;
  serverNow: number;
  startAt: number;
  durationMs: number;
  config: { title: string; theme: string; demo: boolean; teams: { name: string; color?: string; style?: Style }[] };
  snapshot: PublicSnapshot;
}

export async function getRaceView(
  slug: string,
  nowMs: number,
  sinceMs?: number,
): Promise<RaceView | null> {
  const row = await (await getStorage()).get(slug);
  if (!row) return null;

  const config = JSON.parse(row.config_json) as RaceConfigStored;
  const status = deriveStatus(nowMs, row.start_at, row.duration_ms);
  // Scheduled races serve nothing but static config (elapsed < 0 => empty
  // horizon) — a fixed pre-start window once leaked a short race's whole
  // timeline before the gun.
  const elapsed = status === 'scheduled' ? -1 : nowMs - row.start_at;
  const complete = config.demo || status === 'finished';

  // Delta requests: only honored for running, incomplete races with a sane
  // cursor; anything else falls back to a full snapshot.
  const since =
    !complete && sinceMs !== undefined && Number.isFinite(sinceMs) && sinceMs >= 0
      ? Math.round(sinceMs)
      : undefined;

  const snapshot: PublicSnapshot =
    config.theme === 'olympics'
      ? toOlympicsSnapshot(
          JSON.parse(row.timeline_json) as OlympicsTimeline,
          elapsed,
          { complete, sinceMs: since },
        )
      : toJourneySnapshot(
          config.theme === 'space' ? 'space' : 'everest',
          JSON.parse(row.timeline_json) as EverestTimeline,
          elapsed,
          { complete, sinceMs: since },
        );

  return {
    slug: row.id,
    status,
    serverNow: nowMs,
    startAt: row.start_at,
    durationMs: row.duration_ms,
    config: {
      title: config.title,
      theme: config.theme,
      demo: config.demo,
      teams: config.teams,
    },
    snapshot,
  };
}
