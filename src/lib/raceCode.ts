import type { Style } from '@/themes/everest/types';
import type { Theme } from './races';

/**
 * Recovery codes v2: one signed string that IS the race.
 *
 * A race is a pure function of (seed, config, start time), so the code
 * rebuilds it anywhere — same outcome, same story, same slug/links —
 * resumed at exactly the right clock position. v2 adds an HMAC signature
 * under the server's secret: the seed inside every accepted code was drawn
 * and committed by the server at creation, so a host cannot forge a code
 * around a hand-picked ("shopped") seed. Restore rejects unsigned or
 * tampered codes.
 *
 * Isomorphic on purpose (WebCrypto only): runs on Workers, Node 18+, and
 * in browsers.
 */

export interface RaceCodePayload {
  v: 2;
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

const PREFIX = 'SMT2';

export class RaceCodeError extends Error {}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin =
    typeof atob === 'function'
      ? atob(pad)
      : Buffer.from(pad, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return b64url(new Uint8Array(sig));
}

export async function encodeRaceCode(
  payload: RaceCodePayload,
  secret: string,
): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${PREFIX}.${body}.${await hmac(secret, body)}`;
}

export async function decodeRaceCode(
  code: string,
  secret: string,
): Promise<RaceCodePayload> {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new RaceCodeError('that does not look like a Summit recovery code');
  }
  const [, body, sig] = parts;
  const expected = await hmac(secret, body);
  if (sig !== expected) {
    throw new RaceCodeError(
      'the code is not valid for this server (damaged, tampered, or from elsewhere)',
    );
  }
  let payload: RaceCodePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    throw new RaceCodeError('the code is damaged (unreadable payload)');
  }
  if (payload.v !== 2) throw new RaceCodeError('this code is from another Summit version');
  if (!/^[0-9a-f]{32}$/.test(payload.seed ?? '')) {
    throw new RaceCodeError('the code is damaged (bad seed)');
  }
  if (!/^[a-z0-9]{6,24}$/.test(payload.slug ?? '')) {
    throw new RaceCodeError('the code is damaged (bad race id)');
  }
  return payload;
}
