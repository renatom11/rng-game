import type { CoreTimeline } from '@/engine/types';
import type { Risk } from './route';

export type Style = 'bold' | 'balanced' | 'cautious';

export type ClimberStatus =
  | 'climbing'
  | 'resting'
  | 'injured'
  | 'turned-back'
  | 'fallen';

/**
 * Compact appearance indices for the generated portrait. All values are
 * plain palette/variant indexes so the client (and the demo bundle) can
 * draw the face without any extra data.
 */
export interface ClimberLook {
  /** Skin tone palette index, drawn inside the climber's heritage band. */
  skin: number;
  /** Hair style variant (includes "tucked under the hood"). */
  hair: number;
  hairColor: number;
  /** Facial hair variant; always 0 when gender is 1. */
  facial: number;
  /** Beanie / hood / cap / bare. */
  headgear: number;
  gender: 0 | 1;
}

export interface Climber {
  name: string;
  role: string; // Expedition Leader, Sirdar, Medic, ...
  // Dossier fields — optional: absent for space crews and for races stored
  // before squads carried dossiers. All generated from the cosmetic 'cast'
  // stream; nothing fate-derived may ever live on a Climber (it would ship
  // in snapshot statics and leak the future).
  nationality?: string;
  /** Emoji flag for the nationality. */
  flag?: string;
  age?: number;
  hometown?: string;
  /** One-line backstory. */
  bio?: string;
  look?: ClimberLook;
}

/** How a climber (or a whole squad) was lost. Ships only on events. */
export type DeathCause =
  | 'fall-crevasse'
  | 'fall-serac'
  | 'fall-face'
  | 'froze'
  | 'exhaustion'
  | 'altitude'
  | 'avalanche';

export type EventType =
  // structural
  | 'race_start'
  | 'phase_change'
  | 'camp_arrival'
  | 'camp_depart'
  | 'descend_rest'
  | 'overtake'
  | 'standings_update'
  | 'weather_window'
  | 'fork_choice'
  | 'summit'
  | 'race_finish'
  // causal
  | 'route_payoff'
  | 'route_punish'
  | 'route_safe_passed'
  | 'setback'
  | 'surge'
  | 'recovery'
  | 'resupply'
  | 'climber_fall'
  | 'climber_injured'
  | 'climber_turned_back'
  | 'team_wipeout'
  // ambient
  | 'radio'
  | 'weather'
  | 'color';

export interface RaceEvent {
  tMs: number;
  type: EventType;
  teamIdx?: number;
  rivalIdx?: number;
  climberIdx?: number;
  nodeId?: string;
  edgeId?: string;
  /** 0 ambient · 1 minor · 2 notable · 3 headline */
  severity: 0 | 1 | 2 | 3;
  text: string;
  /** New activity label for the team, when the event changes what they're doing. */
  activity?: string;
  /** Structured death cause; set on climber_fall / team_wipeout (Everest). */
  cause?: DeathCause;
}

/** Meter indices in the meters value arrays. */
export const METER_KEYS = [
  'o2',
  'rope',
  'food',
  'med',
  'energy',
  'morale',
  'accl',
  'readiness',
] as const;
export type MeterKey = (typeof METER_KEYS)[number];

export interface EverestTeamInput {
  name: string;
  color?: string;
  style?: Style;
}

export interface EverestConfig {
  teams: EverestTeamInput[];
  durationMs: number;
}

export interface EverestTimeline {
  version: 1;
  core: CoreTimeline;
  /** Per team: squad roster (index 0 is the expedition leader). */
  climbers: Climber[][];
  styles: Style[];
  colors: string[];
  /**
   * Route-display keyframes on a shared sparse grid: pos[team][i] ∈ [0,1]
   * along the route; may descend pre-push (rotations), monotone in the push.
   */
  displayTrack: { tMs: number[]; pos: number[][] };
  /** Shared sparse meter grid; values[team][meterIdx][i] ∈ 0..100. */
  meters: { tMs: number[]; values: number[][][] };
  /** Per team, per segment-traversal edge choices are implicit in fork_choice events. */
  events: RaceEvent[];
  /** Teams whose whole squad is lost (bottom placements only), with time. */
  wipeouts: { teamIdx: number; tMs: number }[];
  /** Edge risk lookup convenience for the client. */
  edgeRisk: Record<string, Risk>;
}
