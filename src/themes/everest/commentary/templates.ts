import type { DeathCause, EventType } from '../types';

/**
 * Commentary template library. Slots: {team} {rival} {sherpa} {epithet}
 * {camp} {edge} {alt} {place} {climber} {role} {gap} {leader} {second}
 * {weather}. Tone: cinematic thriller, played straight; deadpan warmth
 * allowed, mockery never.
 */

export const TEMPLATES: Record<EventType, readonly string[]> = {
  race_start: [
    'Dawn at Base Camp. Prayer flags snap in the wind, {gap} expeditions check their ropes, and the mountain says nothing.',
    'The puja is finished. The juniper smoke drifts east — a good sign, the sirdars agree. {gap} teams move to the ice.',
    'Boots on glacier at first light. {gap} expeditions, one summit, and weeks of mountain compressed into a single climb.',
    'Base Camp empties before sunrise. Somewhere above, through all that ice and weather, there is a top to this thing.',
  ],
  phase_change: [
    'The expedition enters a new act: {phase}.',
    'A page turns on the mountain: {phase}.',
    'Radio check, all teams. Next up: {phase}.',
  ],
  camp_arrival: [
    '{team} reach {camp}, {alt} metres. Tents up, stoves on.',
    '{team} clip into the anchor line at {camp}. {sherpa} counts everyone in.',
    '{camp} for {team}. Brew time, then rest.',
    '{team} pull into {camp} at {alt} metres, moving well.',
    'Headlamps at {camp}: {team} are in.',
    '{team} make {camp} in good order. {sherpa} checks the anchors twice anyway.',
    'The last of {team} steps into {camp}. Soup is already on.',
    '{camp}, {alt} metres: {team} arrive with frost on their hoods and something like a smile.',
    '{team} at {camp}. Boots off, bottles counted, weather radio on.',
  ],
  camp_depart: [
    '{team} strike out from {camp}, climbing.',
    'Ropes coiled, {team} leave {camp} behind.',
    '{team} move out of {camp} — upward again.',
    'First light, last checks: {team} climb out of {camp}.',
    '{sherpa} leads {team} out of {camp} at a deliberate, eating-up-the-mountain pace.',
    'Tents struck. {team} put {camp} below them.',
  ],
  descend_rest: [
    '{team} start down for a rest cycle. Losing altitude to gain the summit — the mountain’s oldest arithmetic.',
    '{team} descend to sleep low. {sherpa} calls it "putting strength in the bank."',
    'Down ropes for {team} — a recovery rotation before the next push.',
    '{team} turn downhill. It looks like retreat. It is the opposite.',
    'Climb high, sleep low: {team} head down to thicker air.',
  ],
  overtake: [
    '{team} move past {rival}! The order shuffles at {alt} metres.',
    'A change on the leaderboard: {team} overhaul {rival}.',
    '{team} find another gear and slip by {rival}.',
    'At {alt} metres, in air with a third of the oxygen you are breathing now, {team} walk past {rival} like it is a Sunday stroll.',
    '{rival} look up and see {team}’s bootprints ahead of them. That is new.',
    'One rope length. That is all {team} needed to get past {rival}.',
    '{team} take the inside line and {rival} can only watch them go.',
    'The gap closes, holds, breaks: {team} are through, {rival} behind.',
  ],
  standings_update: [
    'As it stands: {leader} lead, {second} close behind, and the mountain undecided.',
    'The board right now — {leader} on top, {second} in the hunt, everything still to climb.',
    'Standings check: {leader} ahead of {second}, but nobody up here is celebrating yet.',
  ],
  weather_window: [
    'The forecast lands at Base Camp: a summit window is opening. Every team hears it at the same moment.',
    'The jet stream lifts off the summit. Two words move through the camps like electricity: it’s on.',
    'Weather call: clear air coming. The South Col will be crowded tonight.',
  ],
  fork_choice: [
    '{team} commit to {edge}. {sherpa} looks up at it for a long moment and says nothing.',
    'Decision point: {team} choose {edge}.',
    '{team} take {edge}. Bold or wise — the mountain will grade it.',
    'Route call from {team}: {edge}.',
    'A short argument, a shorter silence, and {team} rope up for {edge}.',
    '{sherpa} points once. {team} follow, onto {edge}.',
    'The fork in the ice: {team} go with {edge}.',
  ],
  summit: [
    '{team}. SUMMIT. {alt} metres. There is nothing above them but sky.',
    'THE TOP OF THE WORLD for {team} — {place} to stand on the summit!',
    '{team} take the final steps together. Summit — {place} on top.',
    'The radio crackles: "{team}... summit." {place} to arrive.',
  ],
  race_finish: [
    'The mountain is quiet again. The order is written, and it will not change now.',
    'It is done. Every story on this hill has its ending now.',
  ],
  route_payoff: [
    'The gamble pays! {edge} spits {team} out ahead of the pack — a huge move.',
    '{team}’s line through {edge} works to perfection. Places gained, and style points with them.',
    'Vindication for {team}: {edge} was the fast lane after all.',
  ],
  route_punish: [
    'The gamble breaks. Trouble on {edge} — {team} lose the line, and precious places with it.',
    '{edge} shows its teeth. {team} pinned, the pack streaming past.',
    'The mountain punishes {team} on {edge}. That risky call just got expensive.',
  ],
  route_safe_passed: [
    '{team} play it safe on {edge} — and can only watch the headlamps going past.',
    'Safe. Slow. {team} hold {edge} while the field pours by.',
    'No drama for {team} on {edge}, except on the scoreboard.',
  ],
  setback: [
    'Trouble for {team}: {trouble}. The climb stalls while they sort it.',
    '{team} hit a wall — {trouble}. {sherpa} gets to work.',
    'A bad hour for {team}. {trouble}, and the mountain does not wait.',
    '{trouble}. Of all the days. {team} dig in and deal with it.',
    'The radio from {team} goes terse: {trouble}. Terse is never good.',
  ],
  surge: [
    '{team} are FLYING. Something has clicked, and the altimeter is spinning.',
    'A surge from {team} — heads down, moving like the weather is chasing them.',
    'Watch {team} now. That is the pace of a team that smells the summit.',
    'Whatever {team} had for breakfast, the other camps want the recipe.',
    '{sherpa} sets a pace and {team} hold it. The gap behind them grows.',
  ],
  recovery: [
    '{team} steady the ship. The bad patch is behind them.',
    'Color back in their faces: {team} are climbing properly again.',
    '{team} regroup and move. That wobble is over.',
    'Fixed, taped, fed: {team} are whole again and climbing.',
  ],
  resupply: [
    'Resupply for {team} at {camp}: oxygen bottles, rope, and a hot meal that tastes like hope.',
    '{team} restock at {camp}. Bottles clink, spirits lift.',
    'The porters come through for {team} — full racks again at {camp}.',
  ],
  climber_fall: [
    'A cry over the radio — {climber}, {team}’s {role}, is off the mountain. The rope teams go silent.',
    'Disaster for {team}: {climber} falls on {edge}. The expedition ropes up and keeps moving — for them.',
    '{team} lose {climber} to the mountain. At {alt} metres there is no time to grieve; that comes later.',
  ],
  climber_injured: [
    '{climber} of {team} is hurt — {trouble}. The medic kneels in the snow.',
    'Injury in {team}’s squad: {climber}. Taped, dosed, and climbing on — for now.',
  ],
  climber_turned_back: [
    '{climber} of {team} turns back. The mountain decides who continues, and today it said no.',
    'One headlamp descends alone: {climber} is done. {team} climb on, one lighter.',
  ],
  team_wipeout: [
    'Silence on channel {gap}. {team}’s last rope has gone off the mountain. The expedition is over — the mountain keeps them.',
    'The unthinkable: {team} are gone. All of them. The other camps stand in silence, then keep climbing, because that is what you do.',
  ],
  radio: [
    'Radio chatter: "{camp}, this is {team}... all accounted for. Cold, but climbing."',
    '"Say again?" — wind swallows half of every sentence up here.',
    'Base Camp logs the evening check-ins, one by one.',
    '"{sherpa} says the ice is talking tonight." Nobody asks what it is saying.',
    'A burst of static, then laughter, from somewhere near {camp}. Good sign.',
    '"Copy that, {team}. Keep your rotations honest." — Base Camp, signing off.',
    'The evening net closes with every callsign answered. The mountain allows it, tonight.',
    '"{team} to Base... never mind. Sorted it." Click.',
  ],
  weather: [
    '{weather}',
    'Weather desk: {weather}',
    'From the forecast tent: {weather}',
  ],
  color: [
    'At Base Camp, the cook has made dal bhat for sixty. Morale, measurable, rises.',
    'A raven rides the updraft past {camp}, unbothered by any of this.',
    'Prayer flags fray a little more. The mountain collects its tolls in small ways too.',
    'Somewhere below, a yak bell. Normal life, one vertical mile away.',
    'The stars above {alt} metres do not twinkle. They stare.',
    'A helicopter turns back below {camp}. Above this line, you are on your own.',
    'Someone at Base Camp is playing a harmonica, badly, to great acclaim.',
    'The Icefall doctors reset a ladder by headlamp. Unthanked, essential.',
    'Frost grows ferns on the inside of every tent. The mountain decorates.',
    'A chocolate bar, carried three weeks for this exact moment, is shared eight ways.',
  ],
};

/**
 * Cause-specific death lines. Rendered under pool key `climber_fall:<cause>`
 * so anti-repetition cycles per cause. Slots available at the one call site:
 * {climber} {role} {team} {alt} {edge} {sherpa}.
 */
export const DEATH_TEMPLATES: Record<DeathCause, readonly string[]> = {
  'fall-crevasse': [
    'The ladder shifts, the rope comes taut, and {climber} of {team} is gone into the blue below. The glacier keeps what it takes.',
    'A crevasse takes {climber} — {team}’s {role} — in one silent second. The rope team stares at the edge for a long time.',
    '{climber} steps where ten thousand steps have held, and the glacier opens. {team} anchor, call down, wait. The mountain does not answer.',
  ],
  'fall-serac': [
    'A serac the size of a house lets go above {edge}. {climber} of {team} does not come out the other side.',
    'The ice towers shrug — that is all it takes. {team} lose {climber}, their {role}, beneath the collapse.',
    'Blue ice, falling. When the cloud settles, {team} count heads and come up one short: {climber}.',
  ],
  'fall-face': [
    'A crampon skates on bare ice at {alt} metres — {climber}, {team}’s {role}, is off the mountain. The rope teams go silent.',
    'Disaster for {team} on {edge}: {climber} falls, and the face gives nothing back.',
    '{team} lose {climber} on {edge} at {alt} metres. There is no time to grieve up here; that comes later.',
  ],
  froze: [
    'The cold wins one. {climber} of {team} sits down at {alt} metres and does not stand up again.',
    '{team} find {climber} still clipped to the line, facing the sunrise, already gone. The cold took them where they stood.',
    'Radio from {team}, very quiet: {climber} did not make it through the night. At {alt} metres the cold is not weather; it is a verdict.',
  ],
  exhaustion: [
    '{climber} of {team} has given everything, and everything was not enough. They stop, sit, and slip away within the hour.',
    'The tank runs empty at {alt} metres. {team} lose {climber} — not to a fall, not to a storm. To the arithmetic.',
    'No food, no strength, no margin: {climber}, {team}’s {role}, is gone quietly between camps.',
  ],
  altitude: [
    'HACE takes hold of {climber} above {alt} metres. {sherpa} calls it early, but there is no “down” fast enough. {team} lose their {role}.',
    '{climber} of {team} stops making sense on the radio, then stops talking. Altitude sickness — the thin air claims its own.',
    'The altitude finds {climber}. {team} do everything right, and it does not matter.',
  ],
  avalanche: [
    'The slope above {edge} releases. When the snow settles, {team} dig — and find only {climber}’s pack.',
    'Avalanche across the route! {team} count off — {climber}, their {role}, does not answer.',
    'A white wall takes the line {climber} was crossing. {team} probe until dark.',
  ],
};

/** Wipeout lines by cause, pool-keyed `team_wipeout:<cause>`. Slots: {team} {gap}. */
export const WIPEOUT_TEMPLATES: Record<'froze' | 'avalanche', readonly string[]> = {
  froze: [
    'Silence on channel {gap}. {team} sat out the storm high on the mountain, and the storm outlasted them. The expedition is over — the mountain keeps them.',
    'The wind drops at last, and {team}’s tents are empty shells of ice. All of them, gone to the cold.',
    'The unthinkable: {team} are gone. All of them. The other camps stand in silence, then keep climbing, because that is what you do.',
  ],
  avalanche: [
    'The face above {team} releases all at once — the whole slope. Channel {gap} goes quiet and stays quiet. The mountain keeps them.',
    'One roar, then stillness. Where {team}’s rope was, there is only new snow. No one is coming out.',
    'The unthinkable: {team} are gone. All of them. The other camps stand in silence, then keep climbing, because that is what you do.',
  ],
};

/** Radio lines after a death: the squad is smaller and the pace shows it.
 * Slots: {team} {sherpa}. */
export const SHORT_HANDED = [
  '{team} redistribute the load — more weight on fewer shoulders. The pace shows it.',
  'Short-handed now, {team} climb slower and closer together. {sherpa} keeps them roped tight.',
  'Every task in {team}’s camp takes longer tonight. A missing person is also missing hands.',
  '{team} move again, carefully, carrying more each and saying less.',
  'The rope behind {sherpa} is shorter than it was. {team} climb on at a diminished pace.',
];

/** Severity-2 weather events at each storm onset. No slots. */
export const STORM_ONSET = [
  'The sky closes. A storm is on the mountain, and every camp is suddenly holding its breath.',
  'Barometers dive across the camps. Here comes the weather.',
  'The forecast tent goes quiet, then very busy: storm inbound. Ropes are fixed, tents double-staked.',
];

/** Ambient weather lines used while a storm window is open. Teams may
 * still be narrated moving through it, so the lines slow the world down
 * without claiming it has stopped. */
export const STORM_LINES = [
  'Wind over the ridgelines like a freight train. The teams still out keep their heads down.',
  'Visibility down to a rope length. Progress, where there is any, slows to a crawl.',
  'Snow loads the high slopes hour by hour. The avalanche watchers do not sleep.',
  'Tents flex to the limit of their poles. Everything that can be tied down is.',
];

export const TROUBLES = [
  'a shredded crampon strap',
  'a frozen regulator on the lead bottle',
  'a snapped fixed line above the anchor',
  'altitude sickness in the lead pair',
  'a stove that will not light at altitude',
  'whiteout on the traverse',
  'a lost route marker in blowing snow',
  'rope drag on the crux pitch',
];

export const WEATHER_LINES = [
  'lenticular cap forming on the summit pyramid — wind aloft.',
  'Spindrift avalanches off the shoulder. Small ones. So far.',
  'Temperature at the Col: thirty-eight below, before wind.',
  'The Icefall groans and settles. The ladder teams cross faster than usual.',
  'High cirrus streaming east — change is coming.',
  'Dead calm at Base Camp. Nobody trusts it.',
];

export const PHASE_NAMES = [
  'the Khumbu Icefall',
  'the climb to the Western Cwm',
  'acclimatization rotations',
  'the Lhotse Face',
  'the weather window and the South Col',
  'the summit push',
];
