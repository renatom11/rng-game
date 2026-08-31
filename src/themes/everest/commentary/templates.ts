import type { EventType } from '../types';

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
  ],
  camp_depart: [
    '{team} strike out from {camp}, climbing.',
    'Ropes coiled, {team} leave {camp} behind.',
    '{team} move out of {camp} — upward again.',
  ],
  descend_rest: [
    '{team} start down for a rest cycle. Losing altitude to gain the summit — the mountain’s oldest arithmetic.',
    '{team} descend to sleep low. {sherpa} calls it "putting strength in the bank."',
    'Down ropes for {team} — a recovery rotation before the next push.',
  ],
  overtake: [
    '{team} move past {rival}! The order shuffles at {alt} metres.',
    'A change on the leaderboard: {team} overhaul {rival}.',
    '{team} find another gear and slip by {rival}.',
    'At {alt} metres, in air with a third of the oxygen you are breathing now, {team} walk past {rival} like it is a Sunday stroll.',
    '{rival} look up and see {team}’s bootprints ahead of them. That is new.',
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
  ],
  surge: [
    '{team} are FLYING. Something has clicked, and the altimeter is spinning.',
    'A surge from {team} — heads down, moving like the weather is chasing them.',
    'Watch {team} now. That is the pace of a team that smells the summit.',
  ],
  recovery: [
    '{team} steady the ship. The bad patch is behind them.',
    'Color back in their faces: {team} are climbing properly again.',
    '{team} regroup and move. That wobble is over.',
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
    'Base Camp logs the check-ins. All teams accounted for.',
    '"{sherpa} says the ice is talking tonight." Nobody asks what it is saying.',
  ],
  weather: [
    '{weather}',
    'Weather desk: {weather}',
  ],
  color: [
    'At Base Camp, the cook has made dal bhat for sixty. Morale, measurable, rises.',
    'A raven rides the updraft past {camp}, unbothered by any of this.',
    'Prayer flags fray a little more. The mountain collects its tolls in small ways too.',
    'Somewhere below, a yak bell. Normal life, one vertical mile away.',
    'The stars above {alt} metres do not twinkle. They stare.',
  ],
};

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
