# Summit — Visual Direction

The working record of the visual overhaul: what the product looks like, why
each call was made, and where the remaining leverage is. Two branches came
out of the overhaul night:

- **`claude/visual-cinematic`** — the painted 2.5D direction, complete.
- **`claude/visual-depth`** — everything in the first branch **plus** the
  mountain in 3D as the default Everest stage (the painted profile stays one
  tap away). This branch supersedes the other; keep both until you've chosen.

Nothing in either branch changes the simulation. The outcome is drawn first
from an isolated stream; everything below is what people see while they wait
to find out. Every pixel derives from data the client already has — display
positions, served storm windows, and elapsed/duration — so the visuals
cannot leak or bend an ending.

---

## 1. Identity

An **expedition dispatch**, not a game HUD. The reference feeling: reading a
1930s expedition telegram by lamplight, except the telegram updates itself.

- **Type.** Fraunces (variable serif; optical size and SOFT axes used, not
  just the family name) for display — race titles, climber names, the
  landing wordmark, finale callouts. Schibsted Grotesk for UI. Martian Mono
  for data: clocks, altitudes, codes, vitals. The rule: serif = story,
  grotesk = interface, mono = instrument readout.
- **Color.** Ink-navy ramp for ground (`--ink-0..4`), snow-white text ramp,
  and two accent families: **gold** (`#e9bc63` / `#ffdf9e`) for the story —
  titles, the route, the summit, primary actions — and **ice**
  (`#8fd9ff` / `#48a8dc`) for the interface — links, sliders, focus.
  Semantic ok/warn/danger stay their own axis and never substitute for the
  accents. The primary CTA wears gold; a glossy blue pill was the one
  element every reviewer flagged as off-brand, and they were right.
- **Surfaces.** Glass panels (gradient + blur + hairline) over an ambient
  page atmosphere: an aurora breath at the top of every page, vignette
  below. Panel titles are letterspaced caps with a fading hairline.
- **Teams.** The curated eight-color palette is CVD-checked against the
  panel ground and assignment-ordered; tags derive from distinctive words
  (The Yak Attack → `YAK`, never `THE`).

## 2. Light is the clock

The single organizing idea across both branches. Race progress `u = t/T`
drives one shared lighting arc (`sceneLight(u, storm)` — seven keyframes
plus a storm palette):

dawn → alpine morning → flat noon → afternoon → **alpenglow** (u≈0.80) →
nightfall (u≈0.885) → **deep night for the summit push** → first light for
the results.

The schedule is deliberate: the storm-window gambling happens in honest
daylight, the pre-push regroup gets the most beautiful light of the day, and
the finale — the only part everyone watches live — happens in the dark,
where headlamps, tent glow, and the summit beacon carry the frame. Storms
mix the whole palette toward grey-violet; at full intensity the mountain
whites out entirely and even your own team disappears (the rail still
knows; the mountain doesn't).

## 3. The painted mountain (2.5D)

A faceted massif painted in SVG behind the route: lit/shade snow planes,
rock bands, three receding far-ridge lines under haze, a glacier, sun and
moon on real arcs, drifting clouds, stars that arrive with darkness,
tent-glyph camps that light from inside at night, headlamp cones on the
markers after dark, and a summit beacon that is always the brightest thing
on the map. The route calms down (gentler zigzags) so the painted faces
carry the drama; risk-branch colors stay the legend's job.

Landing page: the same scene, held at alpenglow, cropped to the summit
pyramid as a full-viewport hero behind the wordmark.

## 4. The mountain in space (3D, `claude/visual-depth`)

three.js, loaded lazily only on the Everest race page (~170 KB gz client
chunk; the Cloudflare worker is untouched at ~0.8 MB gz of its 3 MB cap).

**Geography.** A hand-authored heightfield of the Everest–Lhotse–Nuptse
horseshoe built from base-relative soft-max primitives: the Western Cwm is
genuinely enclosed, the Lhotse Face is a wall, the South Col is a real
saddle, and the West Shoulder blocks the summit from Base Camp — the lowest
camera cannot see the goal. Skyline impostors (Pumori, Ama Dablam, Cho Oyu,
Kangchenjunga, Baruntse, and Makalu to the east, where dawn comes up) give
the horizon its shapes. The surface is pinned to the route corridor so the
climbing line lies on the snow, not in the air.

**Art direction: cartographic at distance, matte at altitude.** Slate
contour lines every 250 m fade out above ~7,900 m; snow/ice/rock/moraine
albedo comes from altitude, slope, and region masks (blue ice on the face,
the Yellow Band, the Geneva Spur's dark rib, moraine below the snowline,
blinding glacier white in the Cwm); above 8,000 m the palette cools and
abstracts. At night the snow keeps a faint starlit luminance so the massif
never collapses into a void.

**Teams are lights.** No human figures at any zoom. Each team is a
constant-screen-size chip with a glow that warms into a headlamp after
dark, a 300 m vertical beam (a team behind a ridge still reads; the night
mountain becomes a procession of signal fires), and a short route-hugging
trail whose length encodes recent speed. Co-located chips fan out along the
camera axis; wiped teams go dim and beamless. Summited teams park down the
northwest shoulder in arrival order, feet on the snow.

**Camera.** Three modes. *Ambient*: a slow auto-orbit whose target drifts
to the field's centroid and whose distance fits the field's spread — the
framing itself is a leaderboard readout — biased so the summit stays in
shot. *Manual*: drag to orbit, wheel to dolly, tap a chip to select; goes
back to ambient after sixteen idle seconds or one tap of "Follow the
action." *Section snap*: Massif / Base Camp / Icefall / Cwm / Lhotse Face /
South Col / Summit Ridge, one tap each, above the transport bar.

**The summit sequence** is authored, not simulated: at push start the
camera drops to the Col and looks up the black Southeast Ridge as the lamps
leave camp; when the leader crosses the South Summit it moves to the ridge
looking east for dawn; on the first arrival it does the one thing it never
does all race — pulls back to hold the whole Himalaya below the winner, and
stays there while the rest top out.

**Labels** are DOM, in the house serif, riding above the canvas with a soft
scrim — never billboarded onto terrain. They tier by camera distance and
clamp away from pane edges.

## 5. The panels

- **Standings** rows FLIP-glide to their new rank; a live height-order list
  that churns honestly during rotations.
- **Team card**: full-width dossiers (portrait, flag, name, role, age,
  hometown, one-line bio — deduped per race), per-climber vitals with
  semantic color when someone is running on fumes, a 260° readiness dial as
  the card's headline number, and a two-column supplies strip (o2, food,
  energy, acclimatization — the four meters that move and mean something).
- **Finale board**: alive-pips per team with a legend, arrival clocks for
  finishers ("up at 9:17"), FLIP reordering, and the map vignettes down so
  the mountain holds the light. Summit arrivals get an expanding halo in
  team color at the peak.
- **The position chart** draws the same story the dispatches narrate — live
  height order, not checkpoint paper order.
- **Results**: gold/silver/bronze podium numerals, serif winner, the
  memorial ("The mountain keeps them") when a race had a cost.
- **Recovery code** collapsed to one quiet row; the code reveals on demand.

## 6. Deliberate omissions

- **No human figures, ever** — scale honesty; the dossiers carry humanity.
- **No 3D leaderboard** — the rail already works; the mountain makes you
  *feel* the rankings.
- **Team palette not re-spaced** despite adjacent-hue critique: the
  existing order passed dataviz CVD checks against the panel ground, and
  every surface pairs color with a written tag. Documented tradeoff.
- **The Hillary Step is not literal geometry** — at the built grid
  resolution it reads as the final ridge steepening; the queue drama is
  carried by the marker string and the board.

## 7. Where the leverage is next

In impact order, mirroring the build-order that got here:

1. **Weather with form**: summit plume scaled by wind, the lenticular cap
   as an omen, Cwm cloud pouring up-valley in the afternoon, spindrift off
   the ridges. The whiteout already works; these make the sky an
   instrument.
2. **Camps as places**: tent clusters exist; give Base Camp its prayer-flag
   color and clutter, Camp III its wrongness (ledges on a wall), the Col
   its scoured emptiness and wind-shivered fabric.
3. **Directed event camera**: minor events never move it; moderate ones
   push in; majors cut to per-location vocabulary (low through the seracs,
   flat side-on for the Face, high wide for the Col); three rare angles
   saved for once each per race.
4. **The descent epilogue**: after the last arrival, run the teams home at
   speed into a lit Base Camp before the sealed-code reveal.
5. **Sound** (muted by default): wind by altitude, regulator hiss above the
   Col, silence at the summit.

## 8. Verification discipline

Every visual change in these branches was iterated against real
screenshots (Playwright, five race phases plus landing and mobile), then
reviewed by a four-lens adversarial panel (typography, color/legibility,
data-display honesty, premium first-impression) whose confirmed findings
were fixed and re-shot. The full suite (102 tests) and production builds
(`next build`, `opennextjs-cloudflare build`) are green on both branches;
the worker script stays ~0.8 MB gz — three.js ships only as a lazy client
asset.
