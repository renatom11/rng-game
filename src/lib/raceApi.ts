import {
  DURATION_MAX_MS,
  validateCreateInput,
  ValidationError,
  type CreateRaceInput,
  type RaceConfigStored,
} from './races';
import { getStorage, type RaceMetaRow } from './storage';
import { decodeRaceCode, encodeRaceCode, RaceCodeError } from './raceCode';
import {
  parseUpload,
  pushStartFor,
  validateChunkWindows,
  UploadFormatError,
} from './chunking';
import { horizonFor } from './slice';
import { deriveStatus } from './time';

/**
 * The thin server. Every handler here must run inside the Workers free
 * tier's ~10ms CPU budget, which shapes the whole design:
 *
 * - init: validate a small config, draw + COMMIT the seed, store one row.
 * - upload: substring-slice the creator's pre-chunked payload (no JSON
 *   parsing of bodies), verify the window grid against our own math, store.
 * - envelope: pick stored chunk bodies by clock arithmetic and concatenate
 *   strings. The final order, the seed, and every future chunk stay in the
 *   database until the clock earns them.
 *
 * Fairness: the seed is server-drawn before the client ever generates, the
 * recovery code is HMAC-signed (no forged seeds through /restore), and
 * after the finish the seed ships in the envelope so ANY viewer can
 * regenerate and verify the uploaded story byte-for-byte.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SLUG_CHARS = 'abcdefghjkmnpqrstvwxyz23456789';

function randomHex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newSlug(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += SLUG_CHARS[b % SLUG_CHARS.length];
  return out;
}

async function codeSecret(): Promise<string> {
  try {
    const mod = await import('@opennextjs/cloudflare');
    const env = mod.getCloudflareContext()?.env as
      | { SUMMIT_CODE_SECRET?: string }
      | undefined;
    if (env?.SUMMIT_CODE_SECRET) return env.SUMMIT_CODE_SECRET;
  } catch {
    // not on Cloudflare
  }
  return process.env.SUMMIT_CODE_SECRET ?? 'summit-dev-secret';
}

export interface InitResult {
  slug: string;
  url: string;
  seed: string;
  recoveryCode: string;
}

/** Create the race shell: committed seed, no timeline yet (ready=0). */
export async function initRace(
  input: CreateRaceInput,
  nowMs: number,
): Promise<InitResult> {
  const { config, durationMs, startAtMs } = validateCreateInput(input, nowMs);
  const seed = randomHex32();
  const slug = newSlug();
  await (await getStorage()).insertMeta({
    id: slug,
    theme: config.theme,
    seed,
    config_json: JSON.stringify(config),
    created_at: nowMs,
    start_at: startAtMs,
    duration_ms: durationMs,
    ready: 0,
  });
  const recoveryCode = await encodeRaceCode(
    {
      v: 2,
      slug,
      seed,
      theme: config.theme,
      title: config.title,
      teams: config.teams,
      durationMs,
      startAtMs,
      demo: config.demo,
      createdAt: nowMs,
    },
    await codeSecret(),
  );
  return { slug, url: `/r/${slug}`, seed, recoveryCode };
}

/** Store the creator-generated timeline. Seed doubles as the upload key. */
export async function acceptUpload(
  slug: string,
  seedHeader: string | null,
  bodyText: string,
): Promise<void> {
  const storage = await getStorage();
  const meta = await storage.getMeta(slug);
  if (!meta) throw new HttpError(404, 'race not found');
  if (meta.ready) throw new HttpError(409, 'race already has its timeline');
  if (!seedHeader || seedHeader !== meta.seed) {
    throw new HttpError(403, 'wrong or missing seed');
  }
  let parsed;
  try {
    parsed = parseUpload(bodyText);
  } catch (err) {
    if (err instanceof UploadFormatError) throw new HttpError(400, err.message);
    throw err;
  }
  const windowErr = validateChunkWindows(parsed.chunks, meta.duration_ms);
  if (windowErr) throw new HttpError(400, windowErr);
  await storage.putTimeline(
    slug,
    parsed.chunks.map((c) => ({
      idx: c.meta.idx,
      fromMs: c.meta.fromMs,
      toMs: c.meta.toMs,
      body: c.body,
    })),
    parsed.finalsBody,
  );
}

/**
 * The poll response, assembled as a string (bodies embedded verbatim):
 * { slug, status, serverNow, startAt, durationMs, config,
 *   cursor, chunks: [...], finals: {...}|null, seed: "..."|null }
 * status: 'preparing' | 'scheduled' | 'running' | 'finished'.
 */
export async function buildEnvelope(
  slug: string,
  nowMs: number,
  cursor: number,
): Promise<string | null> {
  const storage = await getStorage();
  const meta = await storage.getMeta(slug);
  if (!meta) return null;
  const config = JSON.parse(meta.config_json) as RaceConfigStored;
  const status = meta.ready
    ? deriveStatus(nowMs, meta.start_at, meta.duration_ms)
    : 'preparing';
  const elapsed = nowMs - meta.start_at;
  const complete =
    meta.ready === 1 && (config.demo || elapsed >= meta.duration_ms);

  let bodies: string[] = [];
  let newCursor = cursor;
  let finalsBody: string | null = null;
  let seed: string | null = null;
  if (meta.ready) {
    if (complete) {
      const rows = await storage.getChunks(slug, cursor, null);
      bodies = rows.map((r) => r.body);
      if (rows.length > 0) newCursor = rows[rows.length - 1].idx;
      finalsBody = await storage.getFinals(slug);
      seed = meta.seed; // revealed for anyone-can-verify regeneration
    } else if (elapsed >= 0) {
      const horizon = horizonFor(
        elapsed,
        meta.duration_ms,
        pushStartFor(meta.duration_ms),
      );
      const rows = await storage.getChunks(slug, cursor, horizon);
      bodies = rows.map((r) => r.body);
      if (rows.length > 0) newCursor = rows[rows.length - 1].idx;
    }
  }

  return (
    `{"slug":${JSON.stringify(slug)}` +
    `,"status":${JSON.stringify(status)}` +
    `,"serverNow":${nowMs}` +
    `,"startAt":${meta.start_at}` +
    `,"durationMs":${meta.duration_ms}` +
    `,"config":${meta.config_json}` +
    `,"cursor":${newCursor}` +
    `,"complete":${complete}` +
    `,"chunks":[${bodies.join(',')}]` +
    `,"finals":${finalsBody ?? 'null'}` +
    `,"seed":${seed ? JSON.stringify(seed) : 'null'}}`
  );
}

export interface RestoreResult {
  slug: string;
  url: string;
  existed: boolean;
  ready: boolean;
  /** Returned so the restoring browser can regenerate + upload. */
  seed: string;
  theme: string;
  teams: RaceConfigStored['teams'];
  durationMs: number;
}

/** Rebuild the race shell from a signed code; the client re-uploads chunks. */
export async function restoreRace(
  code: string,
  nowMs: number,
): Promise<RestoreResult> {
  let p;
  try {
    p = await decodeRaceCode(code, await codeSecret());
  } catch (err) {
    if (err instanceof RaceCodeError) throw new HttpError(400, err.message);
    throw err;
  }
  const storage = await getStorage();
  const existing = await storage.getMeta(p.slug);
  if (existing) {
    const cfg = JSON.parse(existing.config_json) as RaceConfigStored;
    return {
      slug: p.slug,
      url: `/r/${p.slug}`,
      existed: true,
      ready: existing.ready === 1,
      seed: existing.seed,
      theme: cfg.theme,
      teams: cfg.teams,
      durationMs: existing.duration_ms,
    };
  }
  // Re-validate the embedded config with the code's own start time as "now"
  // — a restored race is allowed (expected!) to have started in the past.
  let validated;
  try {
    validated = validateCreateInput(
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
  } catch (err) {
    if (err instanceof ValidationError) throw new HttpError(400, err.message);
    throw err;
  }
  await storage.insertMeta({
    id: p.slug,
    theme: validated.config.theme,
    seed: p.seed,
    config_json: JSON.stringify(validated.config),
    created_at: p.createdAt ?? nowMs,
    start_at: validated.startAtMs,
    duration_ms: validated.durationMs,
    ready: 0,
  });
  return {
    slug: p.slug,
    url: `/r/${p.slug}`,
    existed: false,
    ready: false,
    seed: p.seed,
    theme: validated.config.theme,
    teams: validated.config.teams,
    durationMs: validated.durationMs,
  };
}

/** Sanity cap shared by routes: nothing bigger than a 24h race can need. */
export const MAX_UPLOAD_CHARS = 12_000_000;
export { DURATION_MAX_MS };
