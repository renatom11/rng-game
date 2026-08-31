import crypto from 'node:crypto';
import { getDb } from './db';
import { deriveStatus, type RaceStatus } from './time';
import { toPublicSnapshot, type PublicSnapshot } from './slice';
import { generateEverest } from '@/themes/everest/generate';
import type { EverestTimeline, Style } from '@/themes/everest/types';

/** Slug alphabet without lookalikes (no 0/O/1/l/i/u). */
const SLUG_CHARS = 'abcdefghjkmnpqrstvwxyz23456789';

function newSlug(): string {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += SLUG_CHARS[b % SLUG_CHARS.length];
  return out;
}

export interface CreateRaceInput {
  title?: string;
  theme?: 'everest';
  teams: { name: string; color?: string; style?: Style }[];
  durationMs: number;
  startAtMs?: number;
  demo?: boolean;
}

export interface RaceConfigStored {
  title: string;
  theme: 'everest';
  teams: { name: string; color?: string; style?: Style }[];
  demo: boolean;
}

export const DURATION_MIN_MS = 60_000;
export const DURATION_MAX_MS = 28_800_000; // 8 hours

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
    throw new ValidationError('duration must be between 1 minute and 8 hours');
  }

  const demo = Boolean(input.demo);
  let startAtMs = input.startAtMs === undefined ? nowMs + 60_000 : Math.round(Number(input.startAtMs));
  if (demo) startAtMs = nowMs;
  if (!Number.isFinite(startAtMs)) throw new ValidationError('bad start time');
  if (startAtMs < nowMs - 5_000) throw new ValidationError('start time is in the past');
  if (startAtMs > nowMs + 30 * 24 * 3_600_000) throw new ValidationError('start time is too far out');

  const title = String(input.title ?? '').trim().slice(0, 80) || 'The Expedition';

  return {
    config: { title, theme: 'everest', teams, demo },
    durationMs,
    startAtMs,
  };
}

export function createRace(
  input: CreateRaceInput,
  nowMs: number,
): { slug: string } {
  const { config, durationMs, startAtMs } = validateCreateInput(input, nowMs);
  const seed = crypto.randomBytes(16).toString('hex');
  const timeline = generateEverest(seed, {
    teams: config.teams,
    durationMs,
  });
  const slug = newSlug();
  getDb()
    .prepare(
      `INSERT INTO races (id, theme, seed, config_json, timeline_json, created_at, start_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      config.theme,
      seed,
      JSON.stringify(config),
      JSON.stringify(timeline),
      nowMs,
      startAtMs,
      durationMs,
    );
  return { slug };
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

export function getRaceView(slug: string, nowMs: number): RaceView | null {
  const row = getDb()
    .prepare('SELECT * FROM races WHERE id = ?')
    .get(slug) as
    | {
        id: string;
        theme: string;
        config_json: string;
        timeline_json: string;
        start_at: number;
        duration_ms: number;
      }
    | undefined;
  if (!row) return null;

  const config = JSON.parse(row.config_json) as RaceConfigStored;
  const timeline = JSON.parse(row.timeline_json) as EverestTimeline;
  const status = deriveStatus(nowMs, row.start_at, row.duration_ms);
  const elapsed = nowMs - row.start_at;
  const complete = config.demo || status === 'finished';

  const snapshot = toPublicSnapshot(
    timeline,
    status === 'scheduled' ? 0 : elapsed,
    { complete },
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
