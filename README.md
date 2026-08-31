# Summit

**A very grand way to sort a list.**

Summit is a duck race on an epic scale: give every name in a list a team, race
them for anywhere from **1 minute to 8 hours**, and let the ending decide the
order — fantasy draft order, chore duty, who goes first, anything. Friends
share one link and check in from their phones at any point; there is always
something happening; and the outcome stays genuinely undecided until the final
act.

Two themes ship today, both skins over the same fair core:

- **🏔 Everest Expedition** — squads of climbers work up the mountain through
  acclimatization rotations, storms, risky-vs-safe route choices, dwindling
  oxygen, individual falls (and, rarely, a whole expedition lost), converging
  on the South Col for a live summit-push finale. Order of summiting is the
  result.
- **🏅 The Games** — delegations compete across a full Olympic programme with
  live events, a medal table, and backloaded marquee events; the closing
  event decides gold. Final points table is the result.

## Fairness, precisely

At creation the server draws a 128-bit seed and derives the final ordering as
a **uniformly random permutation** — that draw is the only real randomness,
and every ordering is exactly equally likely. The entire multi-hour narrative
is then generated *backwards from that ending*, deterministically from the
seed: standings wander freely early (with a deliberately weak signal), every
placement remains reachable until the final ~13%, and the story converges on
the predetermined result only in the finale.

Three properties are enforced by construction and by tests:

1. **Uniformity** — chi-square tests over thousands of seeds; cosmetic inputs
   (names, colors, the Everest "style" knob) provably cannot shift the
   outcome: the core is generated before they are even read, from isolated
   PRNG streams.
2. **Reachability** — at the last pre-finale checkpoint, every
   (current rank → final rank) transition occurs with positive frequency.
3. **Spoiler-proofing** — the timeline is precomputed and stored, but the API
   serves only what has already happened (plus a 60-second rendering
   lookahead). The final order, future events, curves, and results never
   leave the server while a race runs. Your browser *cannot* be used to peek.

Demo races opt out of spoiler-proofing and get playback controls
(1×–600× speed and a scrubber) so you can watch an "8-hour" race in a minute.
Finished races unlock the same controls as a replay.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine + theme + API test suite (fairness, convergence, leaks)
npm run build && npm start   # production
```

The SQLite database lives at `./data/summit.db` by default
(`SUMMIT_DB_PATH` overrides; races are immutable rows — no migrations, no
background jobs, status is derived from the clock). Deploy as a single
persistent Node server; the app is deliberately not serverless-shaped.

## Architecture

```
src/engine/          Theme-agnostic fair core (pure, deterministic):
                     seeded PRNG w/ full-width stream forking; uniform
                     permutation draw; OU checkpoint-standings bridge
                     (weak early signal, full reachability); non-crossing
                     summit-push construction (bounded, decaying drama);
                     monotone progress curves on a shared grid.
src/themes/everest/  Route DAG w/ risk-graded parallel edges, rotation
                     choreography, squads/resources/condition meters,
                     falls & wipeouts (bottom placements only, late),
                     event log + commentary template library.
src/themes/olympics/ Event schedule concluding on core checkpoints,
                     integer points tables realizing each standings order,
                     marquee convergence, live within-event lane curves,
                     its own commentary.
src/lib/             SQLite storage, validation, spoiler-proof slicing.
src/app/             Landing, create form, race page, API routes.
src/components/      Race client: server-offset clock, polling, mountain
                     map (SVG), standings/medal table, dispatches feed,
                     rank bump chart, finale views, results, playback bar.
```

Everything about a race is a pure function of `(seed, config)`; the timeline
is generated once at creation and stored. Clients poll every ~20 s for the
next slice and render smoothly from a server-synced clock — no websockets,
no cron, nothing running between requests.

The narrative layers are generated *after* the outcome is fixed, from
separate PRNG streams, and only ever explain moves the convergence machinery
already dictated: a team that gains ground gets "the risky line paid off";
a team destined for last place gets the storm. Route choices, resource
crises, falls — all decoration, never causation. That is what makes the
drama safe: nothing that happens on screen carries information the fair draw
didn't already decide.

## Testing

`npm test` runs ~50 tests: byte-level determinism, chi-square uniformity,
pairwise head-to-head balance, reachability cell coverage, convergence rank
bounds through the finale, monotonicity/no-teleport guards, resource-range
and continuity checks, wipeout placement constraints, event-density and
silent-gap rules, template slot integrity, points-table realization, live
curve convergence, and API-level leak scans of serialized payloads.

The engine and app layer have also each been through an adversarial
multi-agent review (independent skeptical reviewers plus a refutation pass);
confirmed findings — including a critical PRNG state-width bug that would
have capped the number of distinct races at 2^32 — were fixed and are covered
by regression tests.

Determinism note: timelines are generated and stored server-side in one
process, so cross-engine floating-point differences don't affect stored
races.
