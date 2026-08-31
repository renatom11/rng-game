'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RestorePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [stage, setStage] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      setStage('Checking the code…');
      const res = await fetch('/api/races/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? 'something went wrong');
        setBusy(false);
        setStage(null);
        return;
      }
      if (!data.ready) {
        // This browser regenerates the race from the committed seed and
        // re-uploads it — byte-identical, resumed at the right moment.
        setStage('Recharting the mountain…');
        const { generateAndUpload } = await import('@/lib/clientGen');
        await generateAndUpload(
          data.slug,
          data.seed,
          data.theme,
          data.teams,
          data.durationMs,
        );
      }
      router.push(data.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error — try again');
      setBusy(false);
      setStage(null);
    }
  };

  return (
    <main className="form-shell">
      <p className="crumbs"><Link href="/">← Summit</Link></p>
      <h1 className="race-title">Restore a race</h1>
      <p className="form-sub">
        Paste a recovery code and the race comes back exactly as it was —
        same teams, same story, same ending, same link — picked up at
        precisely the right moment. The code was shown once, to whoever
        created the race.
      </p>
      <label className="field">
        <span>Recovery code</span>
        <textarea
          className="restore-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="SMT1.…"
          rows={5}
          spellCheck={false}
        />
      </label>
      {err && <p className="form-err">{err}</p>}
      <button className="cta" onClick={submit} disabled={busy || !code.trim()}>
        {busy ? (stage ?? 'Rebuilding the mountain…') : 'Restore the race'}
      </button>
    </main>
  );
}
