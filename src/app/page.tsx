'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const DEMO_EVEREST = [
  'The Yak Attack', 'Crampon Gang', 'Sherpa Tensing', 'Altitude Adjusted',
  'The Icefall Guys', 'Peak Performance', 'Oxygen Debt', 'Cornice Riders',
];

const DEMO_OLYMPICS = [
  'Norwegia', 'Atlantis', 'Kingdom of Zeal', 'Freedonia',
  'Wakanda', 'Genovia', 'Latveria', 'Elbonia',
];

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const watchDemo = async (theme: 'everest' | 'olympics') => {
    setBusy(theme);
    try {
      const res = await fetch('/api/races', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          theme,
          title: theme === 'olympics' ? 'Demo Games' : 'Demo Expedition',
          teams: (theme === 'olympics' ? DEMO_OLYMPICS : DEMO_EVEREST).map(
            (name) => ({ name }),
          ),
          durationMs: 600_000,
          demo: true,
        }),
      });
      const data = await res.json();
      if (res.ok) router.push(data.url);
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  };

  return (
    <main className="landing">
      <div className="landing-hero">
        <p className="landing-kicker">A very grand way to sort a list</p>
        <h1 className="landing-title">SUMMIT</h1>
        <p className="landing-tag">
          Draft order. Chore duty. Who goes first. Give every name an Everest
          expedition or an Olympic delegation, race them for anywhere from a
          minute to eight hours, and let the ending decide — provably fair,
          gloriously dramatic.
        </p>
        <div className="landing-ctas">
          <Link className="cta" href="/new">
            Create a race
          </Link>
          <button
            className="cta cta-ghost"
            onClick={() => watchDemo('everest')}
            disabled={busy !== null}
          >
            {busy === 'everest' ? 'Preparing…' : '🏔 Everest demo'}
          </button>
          <button
            className="cta cta-ghost"
            onClick={() => watchDemo('olympics')}
            disabled={busy !== null}
          >
            {busy === 'olympics' ? 'Preparing…' : '🏅 Olympics demo'}
          </button>
        </div>
      </div>
      <ul className="landing-points">
        <li>
          <strong>Perfectly fair.</strong> The final order is a uniformly random
          draw — team names, colors, and climbing styles never change anyone&apos;s
          odds.
        </li>
        <li>
          <strong>Check in any time.</strong> Share one link. Rotations, storms,
          oxygen counts, route gambles, medal tables — there&apos;s always
          something happening.
        </li>
        <li>
          <strong>Undecided until the end.</strong> Every place stays within
          reach until the final act. The server won&apos;t even tell your
          browser the ending — it literally can&apos;t be spoiled.
        </li>
      </ul>
    </main>
  );
}
