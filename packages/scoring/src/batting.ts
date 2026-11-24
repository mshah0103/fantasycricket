import type { BattingStats, HalfPoints, ScoreComponent } from './types.js';
import { hp } from './points.js';
import { bandHalfPoints, SR_POINTS, SR_THRESHOLDS } from './bands.js';

const MILESTONES: readonly (readonly [runs: number, points: number])[] = [
  [150, 10], [100, 8], [75, 5], [50, 3], [25, 2], [10, 1],
];

/** Strike-rate band points, or null when fewer than 10 balls were faced. */
export function strikeRateHalfPoints(runs: number, balls: number): HalfPoints | null {
  if (balls < 10) return null;
  return bandHalfPoints(runs, balls, 100, SR_THRESHOLDS, SR_POINTS);
}

export function scoreBatting(b: BattingStats, phase: 'regulation' | 'super_over'): ScoreComponent[] {
  const out: ScoreComponent[] = [];
  const add = (code: ScoreComponent['code'], quantity: number, halfPoints: HalfPoints) => {
    if (halfPoints !== 0) out.push({ phase, code, quantity, halfPoints });
  };

  add('bat_runs', b.runs, b.runs * hp(0.5));
  add('bat_fours', b.fours, b.fours * hp(1));
  add('bat_sixes', b.sixes, b.sixes * hp(1.5));

  if (phase === 'super_over') return out;

  if (b.runs === 0 && b.dismissal !== null && b.dismissal !== 'retired_hurt') {
    add('bat_duck', 0, hp(-3));
  }

  const milestone = MILESTONES.find(([runs]) => b.runs >= runs);
  if (milestone) add('bat_milestone', b.runs, hp(milestone[1]));

  const sr = strikeRateHalfPoints(b.runs, b.ballsFaced);
  if (sr !== null) {
    add('bat_strike_rate', Math.round((b.runs * 10000) / b.ballsFaced) / 100, sr);
  }
  return out;
}
