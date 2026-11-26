import type { BowlingStats, HalfPoints, ScoreComponent } from './types.js';
import { hp } from './points.js';
import { bandHalfPoints, ECON_POINTS, ECON_THRESHOLDS } from './bands.js';

/** Economy band points, or null when fewer than 12 legal balls (2 overs) were bowled. */
export function economyHalfPoints(runsConceded: number, legalBalls: number): HalfPoints | null {
  if (legalBalls < 12) return null;
  return bandHalfPoints(runsConceded, legalBalls, 6, ECON_THRESHOLDS, ECON_POINTS);
}

export function scoreBowling(b: BowlingStats, phase: 'regulation' | 'super_over'): ScoreComponent[] {
  const out: ScoreComponent[] = [];
  const add = (code: ScoreComponent['code'], quantity: number, halfPoints: HalfPoints) => {
    if (halfPoints !== 0) out.push({ phase, code, quantity, halfPoints });
  };

  add('bowl_wickets', b.wickets, b.wickets * hp(15));
  if (b.dots !== null) add('bowl_dots', b.dots, b.dots * hp(0.5));
  if (b.maidens !== null) add('bowl_maidens', b.maidens, b.maidens * hp(10));
  if (b.wideDeliveries !== null) add('bowl_wides', b.wideDeliveries, b.wideDeliveries * hp(-1));
  if (b.noBallDeliveries !== null) add('bowl_noballs', b.noBallDeliveries, b.noBallDeliveries * hp(-2));

  if (phase === 'super_over') return out;

  if (b.wickets >= 5) add('bowl_milestone', b.wickets, hp(8));
  else if (b.wickets === 4) add('bowl_milestone', b.wickets, hp(6));
  else if (b.wickets === 3) add('bowl_milestone', b.wickets, hp(4));

  const econ = economyHalfPoints(b.runsConceded, b.legalBalls);
  if (econ !== null) {
    add('bowl_economy', Math.round((b.runsConceded * 600) / b.legalBalls) / 100, econ);
  }
  return out;
}
