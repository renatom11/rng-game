'use client';

import { useState } from 'react';
import type { RaceConfigStored, Theme } from '@/lib/races';

/**
 * Anyone-can-verify: after the finish the server reveals the committed
 * seed, and this button regenerates the ENTIRE race from it in the
 * viewer's own browser, then compares byte-for-byte against what the
 * server actually served. A tampered upload, a swapped ending, a doctored
 * chunk — any of it fails loudly, for any viewer, with no trust in the
 * host required.
 */
export function VerifyFairness({
  slug,
  theme,
  teams,
  durationMs,
}: {
  slug: string;
  theme: Theme;
  teams: RaceConfigStored['teams'];
  durationMs: number;
}) {
  const [state, setState] = useState<'idle' | 'running' | 'pass' | 'fail' | 'error'>('idle');
  const [detail, setDetail] = useState('');

  const run = async () => {
    setState('running');
    setDetail('');
    try {
      const res = await fetch(`/api/races/${slug}?cursor=-1`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.seed || !Array.isArray(data.chunks)) {
        setState('error');
        setDetail('the race is not finished yet, or the server withheld the seed');
        return;
      }
      const { buildUploadBody } = await import('@/lib/clientGen');
      const { built } = await buildUploadBody(theme, data.seed, teams, durationMs);
      if (data.chunks.length !== built.chunks.length) {
        setState('fail');
        setDetail(`chunk count mismatch (${data.chunks.length} served vs ${built.chunks.length} regenerated)`);
        return;
      }
      for (let i = 0; i < built.chunks.length; i++) {
        if (JSON.stringify(data.chunks[i]) !== built.chunks[i].body) {
          setState('fail');
          setDetail(`chunk ${i} differs from the seed's true story`);
          return;
        }
      }
      if (JSON.stringify(data.finals) !== built.finalsBody) {
        setState('fail');
        setDetail('the final results differ from the seed’s true story');
        return;
      }
      setState('pass');
      setDetail(`seed ${data.seed}`);
    } catch {
      setState('error');
      setDetail('verification could not run — try again');
    }
  };

  return (
    <div className={`verify verify-${state}`}>
      {state === 'idle' && (
        <button className="share-btn" onClick={run}>
          🔍 Verify fairness
        </button>
      )}
      {state === 'running' && <span className="verify-line">Regenerating the race from its seed…</span>}
      {state === 'pass' && (
        <span className="verify-line verify-pass">
          ✓ Verified — this browser regenerated the whole race from the
          committed seed and every byte matches. <code>{detail}</code>
        </span>
      )}
      {state === 'fail' && (
        <span className="verify-line verify-fail">
          ✗ VERIFICATION FAILED — {detail}. This race&apos;s story does not
          match its seed.
        </span>
      )}
      {state === 'error' && <span className="verify-line">{detail}</span>}
    </div>
  );
}
