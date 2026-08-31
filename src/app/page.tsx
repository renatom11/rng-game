'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const DEMO_TEAMS = [
  'The Yak Attack', 'Crampon Gang', 'Sherpa Tensing', 'Altitude Adjusted',
  'The Icefall Guys', 'Peak Performance', 'Oxygen Debt', 'Cornice Riders',
];

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const watchDemo = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/races', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Demo Expedition',
          teams: DEMO_TEAMS.map((name) => ({ name })),
          durationMs: 600_000,
          demo: true,
        }),
      });
      const data = await res.json();
      if (res.ok) router.push(data.url);
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <div className="landing-hero">
        <p className="landing-kicker">A very grand way to sort a list</p>
        <h1 className="landing-title">SUMMIT</h1>
        <p className="landing-tag">
          Draft order. Chore duty. Who goes first. Give every name a mountain
          expedition, race them up Everest for anywhere from a minute to eight
          hours, and let the summit decide — provably fair, gloriously dramatic.
        </p>
        <div className="landing-ctas">
          <Link className="cta" href="/new">
            Plan an expedition
          </Link>
          <button className="cta cta-ghost" onClick={watchDemo} disabled={busy}>
            {busy ? 'Preparing…' : 'Watch a 10-minute demo'}
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
          <strong>Check in any time.</strong> Share one link. Rotations,
          storms, oxygen counts, route gambles — there&apos;s always something
          happening on the mountain.
        </li>
        <li>
          <strong>Undecided until the end.</strong> Every place stays within
          reach until the summit push. The server won&apos;t even tell your
          browser the ending — it literally can&apos;t be spoiled.
        </li>
      </ul>
    </main>
  );
}
