import type { HalfPoints } from './types.js';
import { hp } from './points.js';

export const SR_THRESHOLDS = [60, 80, 100, 120, 140, 160, 180, 220, 260, 300] as const;
export const SR_POINTS = [-5, -3, -1, 0, 1, 2, 3, 4, 5, 6, 7] as const;
export const ECON_THRESHOLDS = [4, 5, 6, 7, 8, 9, 10, 11, 13, 15] as const;
export const ECON_POINTS = [7, 5, 4, 3, 2, 1, 0, -1, -3, -5, -7] as const;

/**
 * Exact band lookup using integer cross-multiplication (no float division).
 * Finds the first i with scale * numerator < thresholds[i] * denominator;
 * returns points[i], or the last point value when none match.
 */
export function bandHalfPoints(
  numerator: number,
  denominator: number,
  scale: number,
  thresholds: readonly number[],
  points: readonly number[],
): HalfPoints {
  for (let i = 0; i < thresholds.length; i++) {
    if (scale * numerator < thresholds[i]! * denominator) return hp(points[i]!);
  }
  return hp(points[points.length - 1]!);
}
