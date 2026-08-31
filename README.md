# Summit

**A very grand way to sort a list.**

Summit is a duck race on an epic scale: give every name in a list a team, race
them for anywhere from **1 minute to 24 hours**, and let the ending decide the
order — fantasy draft order, chore duty, who goes first, anything. Friends
share one link and check in from their phones at any point; there is always
something happening; and the outcome stays genuinely undecided until the final
act.

Three themes ship today, all skins over the same fair core:

- **🏔 Everest Expedition** — every name sponsors a squad of four generated
  climbers: real-feeling people with heritage-consistent names, portraits,
  ages, hometowns, and one-line backstories, each with live vitals. Camp
  life is the drama: squads attempt the next camp and get repulsed back to
  where they started, sit out forecast storms to bank strength (or gamble
  and climb into them), and pay for every wasted metre in supplies — the
  patient team sometimes springs past a spent field, and sometimes gets
  caught waiting as the window slams shut. The mountain is brutal: deaths
  come with visible causes (crevasse, serac, the face, exposure,
  exhaustion, altitude sickness, avalanche), red ✕ marks stay where people
  were lost, short-handed squads visibly climb slower, and a results
  memorial names everyone the mountain kept. Order of summiting is the
  result.
- **🏅 The Games** — delegations compete across a full Olympic programme with
  live events, a medal table, and backloaded marquee events; the closing
  event decides gold. Final points table is the result.
- **🚀 The Mars Run** — crews race 78 million kilometres through slingshots,
  solar storms, and resupply loops, converging at Mars Approach Staging while
  the dust storm over the landing site clears, then a powered-descent finale.
  Order of touchdown is the result.

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
   serves only what has already happened, plus a small phased rendering
   lookahead that is hard-capped at the final act's start (and shrinks to a
   few seconds inside it). The final order, future events, curves, and
   results never leave the server while a race runs. Your browser *cannot*
   be used to peek.

Demo races opt out of spoiler-proofing and get playback controls
(1×–600× speed and a scrubber) so you can watch an "8-hour" race in a minute.
Finished races unlock the same controls as a replay.

## Recovery codes & the chunk protocol

A race is a pure function of (seed, config, start time), so creation hands
the host a one-line HMAC-signed **recovery code** that IS the race. If the
server, database, or hosting provider dies mid-race, pasting the code at
`/restore` on any instance sharing the signing secret rebuilds the race
byte-identically — same teams, same story, same ending, same URL slug —
picked up at exactly the right moment. The code contains the sealed ending,
so it is shown once, only to the creator, and never served again.

The serving side runs the **chunk protocol**, designed so the whole app
fits Cloudflare Workers' free tier (~10ms CPU/request): the server draws
and COMMITS the seed at creation, the creator's browser generates the
entire timeline from it and uploads it pre-sliced into time-windowed delta
chunks, and from then on the server only selects stored chunk strings by
clock arithmetic — never generating, never parsing. The chunk grid contains
an edge exactly at the final act's start, so the spoiler hard cap holds
unchanged. Fairness is end-to-end checkable: the committed seed means no
one can reroll for an ending they like, and once the race finishes the seed
is revealed so ANY viewer's browser can regenerate the whole race and
verify every served byte (the "Verify fairness" button on the results
page).

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine + theme + API test suite (fairness, convergence, leaks)
npm run build && npm start   # production
```

Needs **Node 22.13+** and nothing else: local storage uses Node's built-in
`node:sqlite`, so no dependency compiles from source and there is no build
toolchain to install. The database lives at `./data/summit.db` by default
(`SUMMIT_DB_PATH` overrides; rows are immutable, status is derived from the
clock, and both drivers create their own tables — nothing to migrate).

To put it online, one command in a fresh copy deploys it to the **Cloudflare
Workers free tier** — D1 database, signing secret, live URL and all:
double-click `setup.cmd` on Windows, `./setup.sh` on macOS and Linux, or
`npm run setup:cf` anywhere. See [DEPLOY.md](./DEPLOY.md). A single
persistent Node server (`npm run build && npm start`) works just as well.

## Architecture

```
src/engine/          Theme-agnostic fair core (pure, deterministic):
                     seeded PRNG w/ full-width stream forking; uniform
                     permutation draw; OU checkpoint-standings bridge
                     (weak early signal, full reachability); non-crossing
                     summit-push construction (bounded, decaying drama);
                     monotone progress curves on a shared grid.
src/themes/everest/  Route DAG w/ risk-graded parallel edges, rotation
                     choreography (with a decorative short-handed pace
                     lag), generated four-person squads (heritage-linked
                     name banks, dossiers, portrait looks), squad
                     resources/condition meters + derived per-climber
                     vitals, storm windows, deaths with structured causes,
                     wipeouts (bottom placements only, late), event log +
                     commentary template library.
src/themes/olympics/ Event schedule concluding on core checkpoints,
                     integer points tables realizing each standings order,
                     marquee convergence, live within-event lane curves,
                     its own commentary.
src/themes/space/    The Mars run: journey machinery on a trajectory route
                     (risk-graded slingshots), orbital loop-backs, crews,
                     mission-control commentary, starfield map.
src/lib/             SQLite storage, validation, spoiler-proof slicing.
src/app/             Landing, create form, race page, API routes.
src/components/      Race client: server-offset clock, polling, mountain
                     map (SVG), standings/medal table, dispatches feed,
                     rank bump chart, finale views, results, playback bar.
```

Everything about a race is a pure function of `(seed, config)`; the timeline
is generated once at creation and stored. Clients poll on a phase-aware
cadence (relaxed mid-race, 2 s through the finale) using a `?since=` delta
cursor, so each poll carries only what's new; rendering runs smoothly from a
server-synced clock — no websockets, no cron, nothing running between
requests. The serving lookahead is phased and hard-capped at the final act's
start, so no convergence-phase data ever ships early.

The narrative layers are generated *after* the outcome is fixed, from
separate PRNG streams, and only ever explain moves the convergence machinery
already dictated: a team that gains ground gets "the risky line paid off";
a team destined for last place gets the storm. Route choices, resource
crises, falls — all decoration, never causation. That is what makes the
drama safe: nothing that happens on screen carries information the fair draw
didn't already decide.

## Testing

`npm test` runs 93 tests: byte-level determinism, chi-square uniformity,
pairwise head-to-head balance, reachability cell coverage, convergence rank
bounds through the finale, monotonicity/no-teleport guards, resource-range
and continuity checks, wipeout placement constraints, event-density and
silent-gap rules, template slot integrity, points-table realization, live
curve convergence, API-level leak scans of serialized payloads, and the
squad layer: dossier/heritage integrity, death-cause altitude rules,
mortality-rate bounds, sirdar protection, vitals ranges, and proof that
the short-handed pace lag is byte-identical to no-lag before each death
(no served byte anticipates a loss).

The engine and app layer have also each been through an adversarial
multi-agent review (independent skeptical reviewers plus a refutation pass);
confirmed findings — including a critical PRNG state-width bug that would
have capped the number of distinct races at 2^32 — were fixed and are covered
by regression tests.

Determinism note: timelines are generated and stored server-side in one
process, so cross-engine floating-point differences don't affect stored
races.
