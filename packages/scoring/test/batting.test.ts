import { describe, it, expect } from 'vitest';
import { scoreBatting, strikeRateHalfPoints } from '../src/batting.js';

const sum = (cs: { halfPoints: number }[]) => cs.reduce((s, c) => s + c.halfPoints, 0);
const bat = (runs: number, ballsFaced: number, fours = 0, sixes = 0, dismissal: any = 'caught') =>
  ({ runs, ballsFaced, fours, sixes, dismissal });

describe('scoreBatting', () => {
  it('scores Marsh 117 off 64 (10x4, 8x6) as 92.5', () => {
    const cs = scoreBatting(bat(117, 64, 10, 8), 'regulation');
    expect(sum(cs)).toBe(185);
    expect(cs.find(c => c.code === 'bat_milestone')?.halfPoints).toBe(16);
    expect(cs.find(c => c.code === 'bat_strike_rate')?.halfPoints).toBe(8);
  });
  it('applies milestone bands', () => {
    const m = (r: number) => scoreBatting(bat(r, 200), 'regulation')
      .find(c => c.code === 'bat_milestone')?.halfPoints ?? 0;
    expect([9,10,24,25,49,50,74,75,99,100,149,150].map(m))
      .toEqual([0,2,2,4,4,6,6,10,10,16,16,20]);
  });
  it('uses exact strike-rate boundaries', () => {
    expect(strikeRateHalfPoints(22, 10)).toBe(10);  // 220 -> +5
    expect(strikeRateHalfPoints(21, 10)).toBe(8);   // 210 -> +4
    expect(strikeRateHalfPoints(6, 10)).toBe(-6);   // 60 -> -3
    expect(strikeRateHalfPoints(5, 10)).toBe(-10);  // 50 -> -5
    expect(strikeRateHalfPoints(30, 9)).toBeNull(); // under 10 balls
  });
  it('applies the duck rule by dismissal kind', () => {
    const duck = (d: any) => scoreBatting(bat(0, 3, 0, 0, d), 'regulation')
      .find(c => c.code === 'bat_duck')?.halfPoints ?? 0;
    expect(duck('caught')).toBe(-6);
    expect(duck('retired_out')).toBe(-6);
    expect(duck(null)).toBe(0);
    expect(duck('retired_hurt')).toBe(0);
  });
  it('scores Super Over batting as events only', () => {
    const cs = scoreBatting(bat(7, 3, 1, 0, null), 'super_over');
    expect(sum(cs)).toBe(9);
    expect(cs.every(c => c.phase === 'super_over')).toBe(true);
    expect(cs.map(c => c.code).sort()).toEqual(['bat_fours', 'bat_runs']);
    expect(sum(scoreBatting(bat(0, 1, 0, 0, 'bowled'), 'super_over'))).toBe(0);
  });
});
