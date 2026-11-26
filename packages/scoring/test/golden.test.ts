import { describe, it, expect } from 'vitest';
import { scorePlayerMatch } from '../src/index.js';

const noField = { catches: 0, stumpings: 0, runOuts: 0 };
const pm = (regulation: any, superOver: any = null) =>
  ({ fixtureId: 'f', playerId: 'p', teamId: 't', regulation, superOver, flags: [] });
const bowl = (o: any) => ({ legalBalls: 24, runsConceded: 30, wickets: 0, dots: 0, maidens: 0,
  wideDeliveries: 0, noBallDeliveries: 0, ...o });

describe('golden examples (spec 5.9)', () => {
  it('Marsh IPL 2025 m64 = 92.5', () => {
    const r = scorePlayerMatch(pm({ batting: { runs: 117, ballsFaced: 64, fours: 10, sixes: 8, dismissal: 'caught' }, bowling: null, fielding: noField }));
    expect(r.totalHalfPoints).toBe(185);
    expect(r.rulesVersion).toBe('t20-v0.7');
  });
  it('Inglis IPL 2025 m69 = 60.0', () => {
    expect(scorePlayerMatch(pm({ batting: { runs: 73, ballsFaced: 42, fours: 9, sixes: 3, dismissal: 'caught' }, bowling: null,
      fielding: { ...noField, catches: 1 } })).totalHalfPoints).toBe(120);
  });
  it('Bumrah IPL 2025 m63 = 62.0', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 }), fielding: noField })).totalHalfPoints).toBe(124);
  });
  it('constructed per-delivery extras bowler = 17.0', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ wickets: 1, dots: 8, wideDeliveries: 2, noBallDeliveries: 1 }), fielding: noField })).totalHalfPoints).toBe(34);
  });
  it('credited run-out fielder = +8', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: null, fielding: { ...noField, runOuts: 1 } })).totalHalfPoints).toBe(16);
  });
  it('Super Over adds events only (48 reg runs + 7 SO runs with a four = 38.5)', () => {
    const r = scorePlayerMatch(pm(
      { batting: { runs: 48, ballsFaced: 35, fours: 4, sixes: 2, dismissal: null }, bowling: null, fielding: noField },
      { batting: { runs: 7, ballsFaced: 3, fours: 1, sixes: 0, dismissal: null }, bowling: null, fielding: noField }));
    expect(r.totalHalfPoints).toBe(77);
    expect(r.components.filter(c => c.phase === 'super_over').map(c => c.code).sort()).toEqual(['bat_fours', 'bat_runs']);
  });
  it('a player who batted only in the Super Over gets no duck', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: null, fielding: noField },
      { batting: { runs: 0, ballsFaced: 1, fours: 0, sixes: 0, dismissal: 'bowled' }, bowling: null, fielding: noField })).totalHalfPoints).toBe(0);
  });
  it('caught and bowled earns wicket and catch', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ legalBalls: 6, runsConceded: 10, wickets: 1 }),
      fielding: { ...noField, catches: 1 } })).totalHalfPoints).toBe(38);
  });
  it('passes flags through and total equals component sum', () => {
    const flag = { code: 'runout_fielder_missing' as const, fixtureId: 'f', detail: 'x' };
    const r = scorePlayerMatch({ ...pm({ batting: null, bowling: null, fielding: noField }), flags: [flag] });
    expect(r.flags).toEqual([flag]);
    expect(r.totalHalfPoints).toBe(r.components.reduce((s, c) => s + c.halfPoints, 0));
  });
  it('Super Over bowling gets events only', () => {
    const r = scorePlayerMatch(pm({ batting: null, bowling: null, fielding: noField },
      { batting: null, bowling: bowl({ legalBalls: 12, runsConceded: 6, wickets: 3, dots: 6, maidens: 0 }), fielding: noField }));
    expect(r.totalHalfPoints).toBe(96);
    const codes = r.components.map(c => c.code);
    expect(codes).not.toContain('bowl_milestone');
    expect(codes).not.toContain('bowl_economy');
  });
});
