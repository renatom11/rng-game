import type { EventType } from '@/themes/everest/types';

/**
 * Mission commentary. Same event taxonomy as Everest (the type names are
 * internal plumbing — 'summit' means touchdown here), new voice: mission
 * control patter, telemetry deadpan, and the long dark between worlds.
 * Slots: {team} {rival} {sherpa}=Flight Director {epithet} {camp}=waypoint
 * {edge}=trajectory {alt}=distance label {place} {climber} {role} {gap}
 * {leader} {second} {weather} {trouble} {phase}.
 */

export const SPACE_TEMPLATES: Record<EventType, readonly string[]> = {
  race_start: [
    'Ignition. {gap} ships rise on pillars of fire, and the sky gets very big.',
    'The towers fall away. {gap} crews, one red dot in the sky, seventy-eight million kilometres of nothing in between.',
    'Launch day. The ground crews wave from a safe distance; the ships do not wave back.',
    'All pads report clean release. {gap} contrails bend east toward orbit.',
  ],
  phase_change: [
    'Mission phase update: {phase}.',
    'The flight plan turns a page: {phase}.',
    'All ships log the milestone: {phase}.',
  ],
  camp_arrival: [
    '{team} reach {camp}, {alt} out. Systems green.',
    '{team} settle into station at {camp}. {sherpa} confirms the burn schedule.',
    '{camp} for {team}. Checklists, coffee bulbs, a view nobody gets used to.',
    'Telemetry confirms {team} on station at {camp}.',
    '{team} arrive at {camp} with margins to spare.',
  ],
  camp_depart: [
    '{team} light the mains and pull away from {camp}.',
    'Burn complete — {team} leave {camp} behind.',
    '{team} depart {camp}. Next stop is a long way away.',
    'Clamps free, throttles up: {team} press on from {camp}.',
  ],
  descend_rest: [
    '{team} drop into a holding ellipse — a resupply rendezvous before the next leg.',
    '{team} loop back to meet the drone convoy. Losing ground to gain fuel — orbital mechanics has no patience for pride.',
    'Retro burn from {team}: a deliberate fall-back to swap crews onto rest cycles.',
  ],
  overtake: [
    '{team} slide past {rival}! The running order shuffles at {alt}.',
    'A cleaner burn tells: {team} overhaul {rival}.',
    '{team} find a leaner trajectory and slip by {rival}.',
    'At {alt} from home, {team} cross {rival}’s wake and keep going.',
    '{rival} watch a drive plume cross their bow. {team} are through.',
    'One correction burn. That is all {team} needed to clear {rival}.',
  ],
  standings_update: [
    'Mission board: {leader} lead the fleet, {second} in close pursuit.',
    'The plot shows {leader} ahead of {second} — with most of the void still to cross.',
    'Fleet status: {leader} on top, {second} hunting, everyone still in the window.',
  ],
  weather_window: [
    'Word from Mars: the global dust storm is breaking up. The landing window opens.',
    'Meteorology calls it — the storm over the landing site is clearing. Every ship hears it at once.',
    'The red planet blinks its eye open: dust settling, entry corridor going green.',
  ],
  fork_choice: [
    '{team} commit to {edge}. {sherpa} studies the plot for a long moment and says only "copy."',
    'Trajectory call from {team}: {edge}.',
    '{team} choose {edge}. The fuel ledger will grade it.',
    'Nav solution locked — {team} take {edge}.',
    'A short argument on the loop, then {team} burn for {edge}.',
  ],
  summit: [
    '{team}. TOUCHDOWN. Wheels on Mars, and the dust of another world settles on their hull.',
    'CONTACT LIGHT for {team} — {place} to stand on Mars!',
    '{team} ride the plume down. Touchdown — {place} on the surface.',
    'The loop crackles: "{team}... Mars." {place} to arrive.',
  ],
  race_finish: [
    'The last engines cool. The order is written in bootprints now, and it will not change.',
    'Mission complete. Every ship’s story has its ending on the red sand.',
  ],
  route_payoff: [
    'The gamble pays! {edge} flings {team} out ahead of the fleet.',
    '{team}’s line through {edge} runs perfect. Places gained, fuel to spare.',
    'Vindication for {team}: {edge} was the fast lane after all.',
  ],
  route_punish: [
    'The gamble bites. Trouble on {edge} — {team} lose the line, and precious places with it.',
    '{edge} shows its teeth. {team} tumble off-course while the fleet streams past.',
    'The void punishes {team} on {edge}. That daring call just got expensive.',
  ],
  route_safe_passed: [
    '{team} hold {edge} — safe, slow, and watching drive plumes pull away.',
    'No drama for {team} on {edge}, except on the fleet board.',
    '{team} play the percentages on {edge} and pay for it in places.',
  ],
  setback: [
    'Trouble aboard {team}: {trouble}. The burn schedule slips while they fight it.',
    '{team} go quiet on the loop — {trouble}. {sherpa} starts reading procedures.',
    'A bad shift for {team}. {trouble}, and the launch windows do not wait.',
    '{trouble}. Of all the sols. {team} crack the manuals and get to work.',
  ],
  surge: [
    '{team} are FLYING — a textbook burn, and the gap ahead is shrinking fast.',
    'Watch {team} now. That is the trajectory of a crew that smells red dirt.',
    'Something clicked aboard {team}: trim perfect, margins fat, velocity climbing.',
  ],
  recovery: [
    '{team} steady the ship. The bad stretch is behind them.',
    'Green lights again on {team}’s board. They are flying properly now.',
    '{team} regroup and burn. That wobble is over.',
  ],
  resupply: [
    'Docking clamps at {camp}: fresh fuel and food for {team}, and a bundle of letters from home.',
    '{team} take on stores at {camp}. Tanks full, spirits fuller.',
    'The drone convoy finds {team} at {camp} — full racks again.',
  ],
  climber_fall: [
    'A flat tone on the loop — {climber}, {team}’s {role}, is lost during EVA at {alt} out. The fleet flies on, because there is no other direction.',
    'Disaster for {team}: {climber} is lost on {edge}. The airlock cycles empty. The mission continues — for them.',
    '{team} lose {climber} to the void. Out here there is no bringing anyone home; that comes later, in words.',
  ],
  climber_injured: [
    '{climber} of {team} is hurt — {trouble}. The Flight Surgeon straps in beside them.',
    'Medical flag aboard {team}: {climber}. Patched, dosed, and back on shift — for now.',
  ],
  climber_turned_back: [
    '{climber} of {team} is cryo-stabilized and transferred to the returning convoy. The void decides who continues.',
    'One lifepod detaches, homeward: {climber} is done. {team} fly on, one couch empty.',
  ],
  team_wipeout: [
    'Static on channel {gap}. {team}’s transponder is gone. All contact lost — the void keeps them.',
    'The unthinkable: {team} have gone dark. All hands. The other ships hold one minute of silence, then burn on, because that is what crews do.',
  ],
  radio: [
    'On the loop: "{camp} relay, this is {team}... all systems nominal. Cold out here, but flying."',
    '"Say again?" — solar noise chews half of every sentence this far out.',
    'The comm net closes its evening pass with every call sign answered.',
    '"{sherpa} says the ship is humming a half-tone low." Nobody asks what that means.',
    'A burst of static, then laughter, from somewhere near {camp}. Good sign.',
    '"Copy {team}. Keep your burn honest." — mission control, signing off.',
  ],
  weather: [
    '{weather}',
    'Space weather desk: {weather}',
    'From the observatory: {weather}',
  ],
  color: [
    'Back home, someone points a backyard telescope at {gap} tiny moving stars.',
    'Earth is a blue coin, then a blue dot, then a bright pixel someone taped a label to.',
    'A maintenance drone tumbles past {camp}, waving its one good arm. Everyone waves back.',
    'The galley aboard the relay station prints eighty birthday cakes a year. Today: two.',
    'Mars grows one pixel wider in the forward windows. Nobody says anything.',
    'Somewhere in the dark, a golden record is still playing to nobody. The fleet dips its antennas as it passes the bearing.',
  ],
};

export const SPACE_TROUBLES = [
  'a reaction wheel spinning itself to pieces',
  'a coolant loop bleeding into the void',
  'a nav computer rebooting mid-burn',
  'a cracked solar array yoke',
  'a fuel cell running hot and lying about it',
  'a comms dish frozen ten degrees off bearing',
  'micrometeorite pitting on the forward shield',
  'a stuck valve in the main feed line',
];

export const SPACE_WEATHER_LINES = [
  'X-class flare inbound — every crew rotates to the storm shelter.',
  'The solar wind is gusting. Auroras wrap both poles of Earth, far behind.',
  'Coronal mass ejection tracking wide of the fleet. This time.',
  'Radiation counters tick like slow rain on a tin roof.',
  'The deep-space network reports whisper-clear comms. Nobody trusts it.',
  'Dust optical depth over the landing site: still falling.',
];

export const SPACE_PHASE_NAMES = [
  'the ascent to orbit',
  'the trans-lunar leg',
  'the deep-space cruise',
  'the solar corridor',
  'the approach staging and the landing window',
  'the final descent race',
];
