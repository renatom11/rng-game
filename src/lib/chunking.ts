import { PUSH_U } from '@/engine/types';
import {
  toJourneyWindow,
  preLookaheadMs,
  pushLookaheadMs,
  type PublicSnapshot,
} from './slice';
import type { EverestTimeline } from '@/themes/everest/types';
import type { Theme } from './races';

/**
 * The chunk protocol: how Summit runs on a server that is not allowed to
 * think (Cloudflare Workers free tier, ~10ms CPU/request).
 *
 * The creator's browser generates the whole race from a SERVER-COMMITTED
 * seed, slices it into time-windowed delta chunks with this module, and
 * uploads them. From then on the server serves raw chunk bodies selected by
 * pure clock arithmetic — never parsing, never generating. The client
 * chain-merges chunks with the same mergeSnapshot the delta protocol
 * already property-tests.
 *
 * Spoiler-safety is unchanged in kind: chunk N ships only once the phased
 * horizon has passed its window's end, the boundary grid contains
 * pushStartMs exactly (so the pre-push hard cap holds), and the finals
 * (order, times, seed) ship only when the clock says finished. Fairness
 * gets STRONGER: the seed is drawn server-side before the client ever runs,
 * and once the race ends anyone can regenerate from the revealed seed and
 * verify the uploaded story byte-for-byte.
 */

export interface ChunkMeta {
  idx: number;
  fromMs: number;
  toMs: number;
}

export interface BuiltChunks {
  chunks: { meta: ChunkMeta; body: string }[];
  /** Served only when the race is finished (or demo). */
  finalsBody: string;
}

/** The engine's own derivation — must match src/engine/push.ts. */
export function pushStartFor(durationMs: number): number {
  return Math.round(PUSH_U * durationMs);
}

/**
 * The boundary grid: pre-push windows sized like the pre-push lookahead,
 * push windows sized like the push lookahead (so serving granularity is no
 * coarser than the lookahead viewers already live with), with the count
 * capped so a 24h race stays in the low thousands of rows. Deterministic
 * from durationMs alone — the server recomputes it to validate uploads.
 */
export function boundariesFor(durationMs: number): number[] {
  const pushStart = pushStartFor(durationMs);
  let preW = preLookaheadMs(durationMs);
  let pushW = pushLookaheadMs(durationMs);
  const count = () =>
    Math.ceil(pushStart / preW) + Math.ceil((durationMs - pushStart) / pushW);
  while (count() > 3600) {
    preW *= 1.3;
    pushW *= 1.3;
  }
  const bounds: number[] = [];
  for (let t = preW; t < pushStart; t += preW) bounds.push(Math.round(t));
  if (bounds.length === 0 || bounds[bounds.length - 1] !== pushStart) {
    // The hard-cap boundary: a chunk edge sits exactly at push start.
    if (bounds.length > 0 && pushStart - bounds[bounds.length - 1] < preW * 0.25) {
      bounds[bounds.length - 1] = pushStart;
    } else {
      bounds.push(pushStart);
    }
  }
  for (let t = pushStart + pushW; t < durationMs; t += pushW) {
    bounds.push(Math.round(t));
  }
  if (bounds[bounds.length - 1] !== durationMs) bounds.push(durationMs);
  return bounds;
}

/**
 * Slice a full timeline into the chunk list + finals. Chunk 0 covers
 * (-∞, b0] with statics; chunk i covers (b(i-1), b(i)]. Bodies are the
 * exact JSON the classic delta endpoint would have served for those
 * windows, so the client merge path is unchanged.
 */
export function buildChunks(
  theme: Theme,
  timeline: EverestTimeline,
  durationMs: number,
): BuiltChunks {
  const bounds = boundariesFor(durationMs);
  const chunks: BuiltChunks['chunks'] = [];
  for (let i = 0; i < bounds.length; i++) {
    const fromMs = i === 0 ? -1 : bounds[i - 1];
    const toMs = bounds[i];
    const snap: PublicSnapshot = toJourneyWindow(theme, timeline, fromMs, toMs);
    chunks.push({ meta: { idx: i, fromMs, toMs }, body: JSON.stringify(snap) });
  }
  const core = timeline.core;
  const finals = {
    finalOrder: core.finalOrder,
    finalRank: core.finalRank,
    summitTimesMs: core.summitTimesMs,
  };
  return { chunks, finalsBody: JSON.stringify(finals) };
}

/* ----------------- upload wire format ------------------------------------
 * One request body, no JSON.parse of the payload on the server:
 *   line 1: JSON header {chunks:[{idx,fromMs,toMs,offset,length}],
 *            finalsOffset, finalsLength}
 *   '\n'
 *   concatenated chunk bodies + finals body
 * Offsets and lengths are CHARACTER offsets into the tail string (unicode-
 * safe: the runtime decodes the request text natively; the server only
 * slices). The server never JSON-parses a body.
 */

export interface UploadHeader {
  chunks: (ChunkMeta & { offset: number; length: number })[];
  finalsOffset: number;
  finalsLength: number;
}

export function serializeUpload(built: BuiltChunks): string {
  const metas: UploadHeader['chunks'] = [];
  let offset = 0;
  const parts: string[] = [];
  for (const c of built.chunks) {
    metas.push({ ...c.meta, offset, length: c.body.length });
    parts.push(c.body);
    offset += c.body.length;
  }
  const header: UploadHeader = {
    chunks: metas,
    finalsOffset: offset,
    finalsLength: built.finalsBody.length,
  };
  parts.push(built.finalsBody);
  return JSON.stringify(header) + '\n' + parts.join('');
}

export interface ParsedUpload {
  chunks: { meta: ChunkMeta; body: string }[];
  finalsBody: string;
}

export class UploadFormatError extends Error {}

/** Server-side: cheap structural parse — header JSON + substring slicing. */
export function parseUpload(text: string, maxChars = 12_000_000): ParsedUpload {
  if (text.length > maxChars) throw new UploadFormatError('upload too large');
  const nl = text.indexOf('\n');
  if (nl < 0 || nl > 800_000) throw new UploadFormatError('missing header');
  let header: UploadHeader;
  try {
    header = JSON.parse(text.slice(0, nl));
  } catch {
    throw new UploadFormatError('bad header');
  }
  if (
    !Array.isArray(header.chunks) ||
    header.chunks.length === 0 ||
    header.chunks.length > 4000
  ) {
    throw new UploadFormatError('bad header shape');
  }
  const tail = text.slice(nl + 1);
  const readSlice = (offset: number, length: number): string => {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      length > 6_000_000
    ) {
      throw new UploadFormatError('bad body window');
    }
    const s = tail.slice(offset, offset + length);
    if (s.length !== length || s[0] !== '{' || s[s.length - 1] !== '}') {
      throw new UploadFormatError('bad body window');
    }
    return s;
  };
  const chunks = header.chunks.map((c) => {
    if (
      !Number.isInteger(c.idx) ||
      !Number.isInteger(c.fromMs) ||
      !Number.isInteger(c.toMs)
    ) {
      throw new UploadFormatError('bad chunk meta');
    }
    return {
      meta: { idx: c.idx, fromMs: c.fromMs, toMs: c.toMs },
      body: readSlice(c.offset, c.length),
    };
  });
  const finalsBody = readSlice(header.finalsOffset, header.finalsLength);
  return { chunks, finalsBody };
}

/**
 * Validate an upload's window grid against the server's own boundary math.
 * Pure integer comparison — the one thing the free-tier server can afford
 * to be strict about.
 */
export function validateChunkWindows(
  chunks: { meta: ChunkMeta }[],
  durationMs: number,
): string | null {
  const bounds = boundariesFor(durationMs);
  if (chunks.length !== bounds.length) return 'wrong chunk count';
  for (let i = 0; i < bounds.length; i++) {
    const m = chunks[i].meta;
    if (m.idx !== i) return 'chunk indices out of order';
    if (m.fromMs !== (i === 0 ? -1 : bounds[i - 1])) return 'bad chunk window';
    if (m.toMs !== bounds[i]) return 'bad chunk window';
  }
  return null;
}
