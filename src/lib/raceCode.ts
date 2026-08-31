import crypto from 'node:crypto';
import type { Style } from '@/themes/everest/types';
import type { Theme } from './races';

/**
 * Recovery codes: one string that IS the race.
 *
 * A race is a pure function of (seed, config, start time) — the whole
 * timeline regenerates from these bytes deterministically, and "where the
 * race is now" is just the clock measured against startAtMs. So the code
 * makes hosting risk-free: if the server, database, or hosting provider
 * evaporates mid-race, pasting the code into any Summit instance rebuilds
 * the race exactly, at the exact right moment, under the same URL slug
 * (so already-shared links keep working on the same domain).
 *
 * The flip side, stated honestly: the seed determines the ending, so
 * anyone holding the code could, with effort, compute the result early.
 * The code is the host's sealed envelope — save it, don't open it. It is
 * shown once, at creation, and never served again.
 */

export interface RaceCodePayload {
  v: 1;
  slug: string;
  seed: string;
  theme: Theme;
  title: string;
  teams: { name: string; color?: string; style?: Style }[];
  durationMs: number;
  startAtMs: number;
  demo: boolean;
  createdAt: number;
}

const PREFIX = 'SMT1';

function checksum(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 8);
}

export function encodeRaceCode(payload: RaceCodePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${PREFIX}.${body}.${checksum(body)}`;
}

export class RaceCodeError extends Error {}

export function decodeRaceCode(code: string): RaceCodePayload {
  const trimmed = code.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new RaceCodeError('that does not look like a Summit recovery code');
  }
  const [, body, sum] = parts;
  if (checksum(body) !== sum) {
    throw new RaceCodeError('the code is damaged (checksum mismatch) — check for missing characters');
  }
  let payload: RaceCodePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new RaceCodeError('the code is damaged (unreadable payload)');
  }
  if (payload.v !== 1) throw new RaceCodeError('this code is from a newer version of Summit');
  if (!/^[0-9a-f]{32}$/.test(payload.seed ?? '')) {
    throw new RaceCodeError('the code is damaged (bad seed)');
  }
  if (!/^[a-z0-9]{6,24}$/.test(payload.slug ?? '')) {
    throw new RaceCodeError('the code is damaged (bad race id)');
  }
  return payload;
}
