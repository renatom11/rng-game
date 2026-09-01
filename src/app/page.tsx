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

const DEMO_SPACE = [
  'Ad Astra Per Pizza', 'The Von Braunies', 'Red Dirt Racing', 'Escape Velocity',
  'Major Tomfoolery', 'The Oxidizers', 'Slingshot Society', 'Crimson Horizon',
];

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const watchDemo = async (theme: 'everest' | 'olympics' | 'space') => {
    setBusy(theme);
    try {
      const { createRaceFromBrowser } = await import('@/lib/clientGen');
      const result = await createRaceFromBrowser({
        theme,
        title:
          theme === 'olympics'
            ? 'Demo Games'
            : theme === 'space'
              ? 'Demo Mars Run'
              : 'Demo Expedition',
        teams: (theme === 'olympics'
          ? DEMO_OLYMPICS
          : theme === 'space'
            ? DEMO_SPACE
            : DEMO_EVEREST
        ).map((name) => ({ name })),
        durationMs: 600_000,
        demo: true,
      });
      router.push(result.url);
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
          Draft order. Chore duty. Who goes first. Give every name its own
          Everest expedition, race them for anywhere from a minute to a full
          day, and let the mountain decide — provably fair, gloriously
          dramatic.
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
        <li>
          <strong>Crash-proof.</strong> Every race comes with a recovery code
          that rebuilds it — mid-flight, to the second — on any Summit
          server. <Link href="/restore">Restore from a code →</Link>
        </li>
      </ul>
    </main>
  );
}
