'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TEAM_PALETTE } from '@/themes/everest/names';

type Style = 'bold' | 'balanced' | 'cautious' | '';

interface TeamRow {
  name: string;
  style: Style;
}

const DURATIONS: [string, number][] = [
  ['1 minute — quick test', 60_000],
  ['10 minutes — coffee break', 600_000],
  ['1 hour — an evening build-up', 3_600_000],
  ['4 hours — an afternoon epic', 14_400_000],
  ['8 hours — the full workday', 28_800_000],
  ['24 hours — the ultra', 86_400_000],
];

export default function NewRacePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [teams, setTeams] = useState<TeamRow[]>(
    // Twelve rows, pre-named, so "create a race" needs no typing at all —
    // overwrite the ones you care about, delete the rest. Blank rows are
    // dropped on submit.
    Array.from({ length: 12 }, (_, i) => ({ name: `Team ${i + 1}`, style: '' as Style })),
  );
  const [durationMs, setDurationMs] = useState(3_600_000);
  const [customMin, setCustomMin] = useState('');
  const [startMode, setStartMode] = useState<'soon' | 'at'>('soon');
  const [startAtLocal, setStartAtLocal] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setTeam = (i: number, patch: Partial<TeamRow>) => {
    setTeams((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };

  const pasteList = (text: string) => {
    const names = text
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (names.length >= 2) {
      setTeams(names.map((name) => ({ name, style: '' as Style })));
    }
  };

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const body = {
        theme: 'everest' as const,
        title: title.trim() || undefined,
        teams: teams
          .filter((t) => t.name.trim())
          .map((t) => ({
            name: t.name.trim(),
            ...(t.style ? { style: t.style } : {}),
          })),
        durationMs: customMin
          ? Math.round(Number(customMin) * 60_000)
          : durationMs,
        ...(startMode === 'at' && startAtLocal
          ? { startAtMs: new Date(startAtLocal).getTime() }
          : {}),
        demo,
      };
      // The server commits the seed; THIS browser generates the race and
      // uploads it pre-sliced (the server never does heavy work).
      const { createRaceFromBrowser } = await import('@/lib/clientGen');
      const result = await createRaceFromBrowser(body);
      router.push(result.url);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'something went wrong — try again');
      setBusy(false);
    }
  };

  return (
    <main className="form-shell">
      <p className="crumbs"><Link href="/">← Summit</Link></p>
      <h1 className="race-title">Plan a race</h1>
      <p className="form-sub">
        Every team has exactly equal odds — fate decides the order, and nobody
        (including the site) can see the ending before it happens.
      </p>

      <label className="field">
        <span>Expedition name</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Draft Night 2026"
          maxLength={80}
        />
      </label>

      <div className="field">
        <span>
          Teams ({teams.filter((t) => t.name.trim()).length}) — one per person.
          Paste a whole list into any name box.
        </span>
        <div className="team-rows">
          {teams.map((t, i) => (
            <div className="team-row" key={i}>
              <span
                className="team-swatch"
                style={{ background: TEAM_PALETTE[i % TEAM_PALETTE.length][0] }}
              />
              <input
                value={t.name}
                placeholder={`Team ${i + 1}`}
                maxLength={40}
                onChange={(e) => setTeam(i, { name: e.target.value })}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (/[\n,;]/.test(text)) {
                    e.preventDefault();
                    pasteList(text);
                  }
                }}
              />
              <select
                value={t.style}
                onChange={(e) => setTeam(i, { style: e.target.value as Style })}
                title="Style flavors the routes they take — it never changes their odds."
              >
                <option value="">Let the mountain decide</option>
                <option value="bold">Bold</option>
                <option value="balanced">Balanced</option>
                <option value="cautious">Cautious</option>
              </select>
              <button
                className="team-remove"
                onClick={() => setTeams((ts) => ts.filter((_, j) => j !== i))}
                disabled={teams.length <= 2}
                aria-label="Remove team"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          className="team-add"
          onClick={() => setTeams((ts) => [...ts, { name: '', style: '' }])}
          disabled={teams.length >= 50}
        >
          + Add team
        </button>
        <p className="field-hint">
          Style is pure flavor — bold teams take the risky lines, cautious
          ones the safe ones. The odds stay exactly equal either way.
        </p>
      </div>

      <div className="field">
        <span>Race duration</span>
        <div className="duration-grid">
          {DURATIONS.map(([label, ms]) => (
            <button
              key={ms}
              className={`duration-btn${!customMin && durationMs === ms ? ' active' : ''}`}
              onClick={() => {
                setDurationMs(ms);
                setCustomMin('');
              }}
            >
              {label}
            </button>
          ))}
          <label className="duration-custom">
            <input
              type="number"
              min={1}
              max={1440}
              placeholder="custom"
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
            />
            minutes
          </label>
        </div>
      </div>

      <div className="field">
        <span>Start</span>
        <div className="start-row">
          <label>
            <input
              type="radio"
              checked={startMode === 'soon'}
              onChange={() => setStartMode('soon')}
            />
            In one minute (time to share the link)
          </label>
          <label>
            <input
              type="radio"
              checked={startMode === 'at'}
              onChange={() => setStartMode('at')}
            />
            At a set time
          </label>
          {startMode === 'at' && (
            <input
              type="datetime-local"
              value={startAtLocal}
              onChange={(e) => setStartAtLocal(e.target.value)}
            />
          )}
        </div>
      </div>

      <label className="field checkbox-field">
        <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
        <span>
          <strong>Demo mode</strong> — starts immediately with playback controls
          (speed up, scrub). No spoiler protection, so don&apos;t use it for the
          real draw.
        </span>
      </label>

      {err && <p className="form-err">{err}</p>}
      <button className="cta" onClick={submit} disabled={busy}>
        {busy ? 'Consulting the mountain…' : 'Create the expedition'}
      </button>
    </main>
  );
}
