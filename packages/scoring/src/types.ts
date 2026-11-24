export type HalfPoints = number; // integer; 1 = 0.5 fantasy points

export type DismissalKind =
  | 'bowled' | 'caught' | 'caught_and_bowled' | 'lbw' | 'stumped' | 'hit_wicket'
  | 'run_out' | 'retired_hurt' | 'retired_out' | 'obstructing_field' | 'timed_out' | 'handled_ball';

export interface BattingStats {
  runs: number;
  ballsFaced: number;            // excludes wides, includes no-balls faced
  fours: number;                 // boundary fours only
  sixes: number;
  dismissal: DismissalKind | null; // null = not out (or unknown, flagged)
}

export interface BowlingStats {
  legalBalls: number;
  runsConceded: number;          // batter runs + wides + no-balls; excludes byes/leg-byes
  wickets: number;               // bowler-credited only
  dots: number | null;           // null = unknown (no ball-by-ball)
  maidens: number | null;
  wideDeliveries: number | null;
  noBallDeliveries: number | null;
}

export interface FieldingStats { catches: number; stumpings: number; runOuts: number; }

export interface PhaseStats {
  batting: BattingStats | null;  // null = did not bat in this phase
  bowling: BowlingStats | null;  // null = did not bowl in this phase
  fielding: FieldingStats;
}

export type FlagCode =
  | 'runout_fielder_missing' | 'sub_fielder_unidentified' | 'unknown_dismissal'
  | 'ball_data_missing' | 'bowling_card_mismatch' | 'unparseable_record';

export interface DataFlag { code: FlagCode; fixtureId: string; playerId?: string; detail: string; }

export interface PlayerMatchStats {
  fixtureId: string;             // Sportmonks fixture id, as string
  playerId: string;              // Sportmonks player id, as string
  teamId: string;
  regulation: PhaseStats;
  superOver: PhaseStats | null;  // all Super Overs aggregated; null = none
  flags: DataFlag[];
}

export type ComponentCode =
  | 'bat_runs' | 'bat_fours' | 'bat_sixes' | 'bat_duck' | 'bat_milestone' | 'bat_strike_rate'
  | 'bowl_wickets' | 'bowl_milestone' | 'bowl_dots' | 'bowl_maidens' | 'bowl_wides'
  | 'bowl_noballs' | 'bowl_economy'
  | 'field_catches' | 'field_stumpings' | 'field_runouts';

export interface ScoreComponent {
  phase: 'regulation' | 'super_over';
  code: ComponentCode;
  quantity: number;   // the count scored (runs, dots…); for rates, the rate rounded to 2 dp for display only
  halfPoints: HalfPoints;
}

export interface ScoreResult {
  rulesVersion: 't20-v0.7';
  totalHalfPoints: HalfPoints;
  components: ScoreComponent[];  // zero-value components omitted
  flags: DataFlag[];             // passed through from input
}
