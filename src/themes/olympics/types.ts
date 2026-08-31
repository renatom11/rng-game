import type { CoreTimeline } from '@/engine/types';

/**
 * Olympics theme: a tournament skin over the same fair core. Teams are
 * delegations racking up points across a schedule of events; the cumulative
 * points table at each core checkpoint realizes that checkpoint's standings,
 * and backloaded marquee events carry the convergence to the true final
 * order — the last event settles it, naturally.
 */

export interface Athlete {
  name: string;
  specialty: string; // e.g. "sprints", "aquatics"
}

export interface ScheduledEvent {
  /** index into SPORTS */
  sportIdx: number;
  startMs: number;
  endMs: number;
  /** marquee events land in the final phase and carry the drama */
  marquee: boolean;
}

export interface PointsKeyframe {
  tMs: number;
  /** order[0] = current leader (team index) */
  order: number[];
  /** cumulative points per team index */
  points: number[];
  /** points earned in the event that just concluded, per team index */
  earned: number[];
}

export type OlympicsEventType =
  | 'ceremony_open'
  | 'ceremony_close'
  | 'event_start'
  | 'event_finish'
  | 'medal_moment'
  | 'lead_change'
  | 'standings_update'
  | 'athlete_flavor'
  | 'upset'
  | 'crowd'
  | 'venue_color';

export interface OlympicsRaceEvent {
  tMs: number;
  type: OlympicsEventType;
  teamIdx?: number;
  rivalIdx?: number;
  eventIdx?: number;
  severity: 0 | 1 | 2 | 3;
  text: string;
}

export interface OlympicsTimeline {
  version: 1;
  theme: 'olympics';
  core: CoreTimeline;
  athletes: Athlete[][];
  colors: string[];
  schedule: ScheduledEvent[];
  /** one keyframe per concluded event, ascending tMs */
  pointsKeyframes: PointsKeyframe[];
  /**
   * Live within-event performance curves: for each scheduled event,
   * score[team][i] at liveT[i] — higher = currently ahead in that event.
   * Converges to the event's actual result by its end.
   */
  live: { tMs: number[]; score: number[][] }[];
  events: OlympicsRaceEvent[];
}

export interface Sport {
  name: string;
  venue: string;
  /** how a live standing reads, e.g. "leads the pool" */
  kind: 'race' | 'score';
  emoji: string;
}

export const SPORTS: Sport[] = [
  { name: '100m Sprint', venue: 'Olympic Stadium', kind: 'race', emoji: '🏃' },
  { name: '200m Freestyle', venue: 'Aquatics Centre', kind: 'race', emoji: '🏊' },
  { name: 'Team Archery', venue: 'Archery Field', kind: 'score', emoji: '🏹' },
  { name: 'Floor Gymnastics', venue: 'Gymnastics Arena', kind: 'score', emoji: '🤸' },
  { name: 'Weightlifting', venue: 'Lifting Hall', kind: 'score', emoji: '🏋️' },
  { name: 'Épée Fencing', venue: 'Fencing Piste', kind: 'score', emoji: '🤺' },
  { name: 'Team Pursuit', venue: 'Velodrome', kind: 'race', emoji: '🚴' },
  { name: 'Coxed Eights', venue: 'Rowing Basin', kind: 'race', emoji: '🚣' },
  { name: 'Judo', venue: 'Combat Hall', kind: 'score', emoji: '🥋' },
  { name: 'Pole Vault', venue: 'Olympic Stadium', kind: 'score', emoji: '🎯' },
  { name: 'Javelin', venue: 'Olympic Stadium', kind: 'score', emoji: '🎯' },
  { name: 'Table Tennis', venue: 'Table Tennis Hall', kind: 'score', emoji: '🏓' },
  { name: 'Sport Climbing', venue: 'Climbing Wall', kind: 'race', emoji: '🧗' },
  { name: 'Skeet Shooting', venue: 'Shooting Range', kind: 'score', emoji: '🎯' },
  { name: 'Sailing Regatta', venue: 'Marina', kind: 'race', emoji: '⛵' },
  { name: 'BMX Racing', venue: 'BMX Track', kind: 'race', emoji: '🚴' },
];

export const MARQUEE_SPORTS: Sport[] = [
  { name: 'Triathlon Relay', venue: 'City Course', kind: 'race', emoji: '🏊' },
  { name: '4×100m Medley Relay', venue: 'Aquatics Centre', kind: 'race', emoji: '🏊' },
  { name: 'Marathon', venue: 'The Streets', kind: 'race', emoji: '🏃' },
];

export const SPECIALTIES = [
  'sprints', 'aquatics', 'archery', 'gymnastics', 'lifting', 'fencing',
  'cycling', 'rowing', 'judo', 'field events', 'climbing', 'distance',
];
