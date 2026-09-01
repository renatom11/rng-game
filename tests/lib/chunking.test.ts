import { describe, expect, it } from 'vitest';
import { generateEverest } from '@/themes/everest/generate';
import {
  boundariesFor,
  buildChunks,
  parseUpload,
  pushStartFor,
  serializeUpload,
  validateChunkWindows,
} from '@/lib/chunking';
import { toJourneyWindow, type PublicSnapshot } from '@/lib/slice';
import { mergeSnapshot } from '@/lib/client/mergeSnapshot';

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Tèam 🏔 ${i + 1}` }));
}

describe('chunk protocol', () => {
  it('boundaries are sane at every duration: monotone, capped, exact at push start and finish', () => {
    for (const dur of [60_000, 600_000, 3_600_000, 28_800_000, 86_400_000]) {
      const b = boundariesFor(dur);
      expect(b.length).toBeLessThanOrEqual(3600);
      expect(b[b.length - 1]).toBe(dur);
      expect(b).toContain(pushStartFor(dur));
      for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
      expect(b[0]).toBeGreaterThan(0);
    }
  });

  it('journey: chain-merging chunks reproduces the exact window slice at every boundary', () => {
    const dur = 900_000;
    const tl = generateEverest('chunk-ev-1', { teams: teams(7), durationMs: dur });
    const { chunks } = buildChunks('everest', tl, dur);
    let merged: PublicSnapshot | null = null;
    const checkAt = new Set([0, 3, Math.floor(chunks.length / 2), chunks.length - 2, chunks.length - 1]);
    for (let i = 0; i < chunks.length; i++) {
      const snap = JSON.parse(chunks[i].body) as PublicSnapshot;
      merged = merged === null ? snap : (mergeSnapshot(merged, snap) as PublicSnapshot);
      expect(merged).not.toBeNull();
      if (checkAt.has(i)) {
        const direct = toJourneyWindow('everest', tl, -1, chunks[i].meta.toMs);
        expect(JSON.parse(JSON.stringify(merged))).toEqual(
          JSON.parse(JSON.stringify({ ...direct, sinceMs: -1 })),
        );
      }
    }
  });

  it('no chunk body ever contains the finals', () => {
    const dur = 600_000;
    const tl = generateEverest('chunk-ev-2', { teams: teams(6), durationMs: dur });
    const { chunks, finalsBody } = buildChunks('everest', tl, dur);
    for (const c of chunks) {
      expect(c.body).not.toContain('"finalOrder"');
      expect(c.body).not.toContain('"summitTimesMs"');
    }
    expect(finalsBody).toContain('"finalOrder"');
  });

  it('the upload wire format round-trips (unicode-safe) and rejects malformed payloads', () => {
    const dur = 300_000;
    const tl = generateEverest('chunk-ev-3', { teams: teams(5), durationMs: dur });
    const built = buildChunks('everest', tl, dur);
    const wire = serializeUpload(built);
    const parsed = parseUpload(wire);
    expect(parsed.chunks.length).toBe(built.chunks.length);
    for (let i = 0; i < built.chunks.length; i++) {
      expect(parsed.chunks[i].body).toBe(built.chunks[i].body);
      expect(parsed.chunks[i].meta).toEqual(built.chunks[i].meta);
    }
    expect(parsed.finalsBody).toBe(built.finalsBody);
    expect(validateChunkWindows(parsed.chunks, dur)).toBeNull();
    expect(validateChunkWindows(parsed.chunks, 600_000)).not.toBeNull();

    expect(() => parseUpload('no header here')).toThrow();
    expect(() => parseUpload('{"chunks":[]}\n')).toThrow();
    const evil = wire.replace('"offset":0', '"offset":5');
    expect(() => parseUpload(evil)).toThrow();
  });
});
