import type { HalfPoints } from './types.js';

export const RULES_VERSION = 't20-v0.7' as const;

/** Convert fantasy points to half-points. Throws unless points is a multiple of 0.5. */
export function hp(points: number): HalfPoints {
  const h = points * 2;
  if (!Number.isInteger(h)) {
    throw new RangeError(`${points} is not a multiple of 0.5`);
  }
  return h;
}

export function toPoints(h: HalfPoints): number {
  return h / 2;
}

export function formatPoints(h: HalfPoints): string {
  return toPoints(h).toFixed(1);
}
