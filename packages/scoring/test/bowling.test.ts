import { describe, it, expect } from 'vitest';
import { scoreBowling, economyHalfPoints } from '../src/bowling.js';

const sum = (cs: { halfPoints: number }[]) => cs.reduce((s, c) => s + c.halfPoints, 0);
const bowl = (o: Partial<any>) => ({ legalBalls: 24, runsConceded: 30, wickets: 0, dots: 0,
  maidens: 0, wideDeliveries: 0, noBallDeliveries: 0, ...o });

describe('scoreBowling', () => {
  it('scores Bumrah 3/12 from 20 legal balls with 12 dots as 62', () => {
    expect(sum(scoreBowling(bowl({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 }), 'regulation'))).toBe(124);
  });
  it('penalizes wides and no-balls per delivery', () => {
    const cs = scoreBowling(bowl({ wickets: 1, dots: 8, wideDeliveries: 2, noBallDeliveries: 1 }), 'regulation');
    expect(sum(cs)).toBe(34); // 15 + 4 + 2 - 2 - 2 = 17 points
  });
  it('scores a maiden without economy under 12 legal balls', () => {
    expect(sum(scoreBowling(bowl({ legalBalls: 6, runsConceded: 0, dots: 4, maidens: 1 }), 'regulation'))).toBe(24);
  });
  it('uses exact economy boundaries', () => {
    expect(economyHalfPoints(16, 24)).toBe(10);   // 4.0 -> +5
    expect(economyHalfPoints(15, 24)).toBe(14);   // 3.75 -> +7
    expect(economyHalfPoints(60, 24)).toBe(-14);  // 15.0 -> -7
    expect(economyHalfPoints(59, 24)).toBe(-10);  // 14.75 -> -5
    expect(economyHalfPoints(18, 12)).toBe(0);    // 9.0 -> 0
    expect(economyHalfPoints(5, 11)).toBeNull();
  });
  it('applies wicket milestones', () => {
    const m = (w: number) => scoreBowling(bowl({ wickets: w }), 'regulation')
      .find(c => c.code === 'bowl_milestone')?.halfPoints ?? 0;
    expect([2,3,4,5,6].map(m)).toEqual([0,8,12,16,16]);
  });
  it('handles a bowler with zero legal balls', () => {
    const cs = scoreBowling(bowl({ legalBalls: 0, runsConceded: 5, dots: 0, wideDeliveries: 3 }), 'regulation');
    expect(sum(cs)).toBe(-6);
    expect(cs.some(c => c.code === 'bowl_economy')).toBe(false);
  });
  it('omits unknown ball-level counts', () => {
    const cs = scoreBowling(bowl({ wickets: 1, dots: null, maidens: null, wideDeliveries: null, noBallDeliveries: null }), 'regulation');
    expect(cs.map(c => c.code).sort()).toEqual(['bowl_economy', 'bowl_wickets']);
  });
  it('scores Super Over bowling as events only', () => {
    const cs = scoreBowling(bowl({ legalBalls: 6, runsConceded: 8, wickets: 1, dots: 2 }), 'super_over');
    expect(sum(cs)).toBe(32);
  });
});
