import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scorePlayerMatch, type PlayerMatchStats } from '@fc/scoring';
import { buildScoreCatalog } from '../src/fieldMap.js';
import { fixtureMeta } from '../src/normalize/meta.js';
import { normalizeFixture, type NormalizedFixture } from '../src/normalize/index.js';

type Obj = Record<string, any>;
const load = (name: string): Obj =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

const catalog = buildScoreCatalog(load('scores.json'));
const m64 = load('ipl2025-m64-gt-lsg.json'); // 65607
const m63 = load('ipl2025-m63-mi-dc.json'); // 65608
const m69 = load('ipl2025-m69-pbks-mi.json'); // 65603
const m32 = load('ipl2025-m32-dc-rr-superover.json'); // 65574
const m44 = load('ipl2025-m44-kkr-pbks-noresult.json'); // 65586
const m29 = load('ipl2025-fielding-sample.json'); // 65571
const ALL = { m64, m63, m69, m32, m44, m29 };

function player(n: NormalizedFixture, id: string): PlayerMatchStats {
  const p = n.players.find((x) => x.playerId === id);
  if (!p) throw new Error(`no record for player ${id}`);
  return p;
}

describe('end to end: normalizeFixture then scorePlayerMatch reproduces the spec §5.9 golden scores', () => {
  it('Marsh, m64: 185 half-points (92.5)', () => {
    expect(scorePlayerMatch(player(normalizeFixture(m64, catalog), '31')).totalHalfPoints).toBe(185);
  });

  it('Inglis, m69: 120 half-points (60.0)', () => {
    expect(scorePlayerMatch(player(normalizeFixture(m69, catalog), '623')).totalHalfPoints).toBe(120);
  });

  it('Bumrah, m63: 124 half-points (62.0)', () => {
    expect(scorePlayerMatch(player(normalizeFixture(m63, catalog), '284')).totalHalfPoints).toBe(124);
  });
});

describe('normalizeFixture', () => {
  it('meta is fixtureMeta, players are sorted by numeric id, and output is deterministic', () => {
    for (const [name, body] of Object.entries(ALL)) {
      const n = normalizeFixture(body, catalog);
      expect([name, n.meta]).toEqual([name, fixtureMeta(body)]);
      const ids = n.players.map((p) => Number(p.playerId));
      expect([name, ids]).toEqual([name, [...ids].sort((a, b) => a - b)]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(JSON.stringify(normalizeFixture(body, catalog))).toBe(JSON.stringify(n));
    }
  });

  it('merges batting, fielding and bowling into one record per player', () => {
    const n = normalizeFixture(m63, catalog);
    // Will Jacks (3806): 21 off 13 in S1, bowled 1-0-16-1 with a no-ball in S2.
    const jacks = player(n, '3806');
    expect(jacks.regulation.batting).toMatchObject({ runs: 21, ballsFaced: 13 });
    expect(jacks.regulation.bowling).toMatchObject({ legalBalls: 6, runsConceded: 16, wickets: 1, noBallDeliveries: 1 });
    expect(jacks.teamId).toBe('6');
    expect(n.players.filter((p) => p.playerId === '3806')).toHaveLength(1);
    expect(player(n, '284').regulation.batting).toBeNull();
  });

  it('m32: Super Over bowling is on superOver; a player with no Super Over involvement keeps superOver null', () => {
    const n = normalizeFixture(m32, catalog);
    const sandeep = player(n, '2966');
    expect(sandeep.superOver?.bowling).toMatchObject({ legalBalls: 4, runsConceded: 13, dots: 0 });
    expect(sandeep.regulation.bowling).toMatchObject({ legalBalls: 24, runsConceded: 33 });
    expect(sandeep.superOver?.batting).toBeNull();
    expect(player(n, '36').superOver?.bowling).toMatchObject({ legalBalls: 5, runsConceded: 11, noBallDeliveries: 1 });
    // Sanju Samson (2900) retired hurt in S2; nothing in the Super Over.
    expect(player(n, '2900').superOver).toBeNull();
    // A regulation-only bowler (Maheesh Theekshana 21942, S1 only) has no Super Over phase.
    expect(player(n, '21942').regulation.bowling).not.toBeNull();
    expect(player(n, '21942').superOver).toBeNull();
  });

  it('m44: phantom 0-over bowler has bowling null and no flags', () => {
    const n = normalizeFixture(m44, catalog);
    expect(player(n, '4880').regulation.bowling).toBeNull();
    expect(n.flags).toEqual([]);
  });

  it('real fixtures carry only the known Task 7 flag (m29 single-fielder run-out)', () => {
    for (const [name, body] of Object.entries(ALL)) {
      const codes = normalizeFixture(body, catalog).flags.map((f) => f.code);
      expect([name, codes]).toEqual([name, name === 'm29' ? ['runout_fielder_missing'] : []]);
    }
  });

  it('every flag is on the fixture; a flag about a player is also on his record', () => {
    const body = structuredClone(m64);
    delete body.data.balls;
    (body.data.batting as Obj[]).find((b) => b.player_id === 31)!.score_id = 80; // unknown_dismissal (Task 7)
    const n = normalizeFixture(body, catalog);
    expect(n.flags.map((f) => f.code).sort()).toEqual([...Array(12).fill('ball_data_missing'), 'unknown_dismissal'].sort());
    for (const f of n.flags) expect(player(n, f.playerId!).flags).toContainEqual(f);
    const flagsOnPlayers = n.players.reduce((k, p) => k + p.flags.length, 0);
    expect(flagsOnPlayers).toBe(n.flags.length);
    // Card fallback still scores what the card knows: 8394 bowled 3.1-29-1 with no dot data.
    expect(player(n, '8394').regulation.bowling).toMatchObject({ legalBalls: 19, runsConceded: 29, wickets: 1, dots: null });
  });

  it('a bowler missing from the lineup gets a record on his bowling card team', () => {
    const body = structuredClone(m63);
    body.data.lineup = (body.data.lineup as Obj[]).filter((l) => l.id !== 284);
    const n = normalizeFixture(body, catalog);
    expect(player(n, '284')).toMatchObject({ teamId: '6', regulation: { batting: null }, superOver: null });
    expect(scorePlayerMatch(player(n, '284')).totalHalfPoints).toBe(124);
  });

  it('with no lineup entry and no card row, the bowler is on the team that was not batting', () => {
    const body = structuredClone(m63);
    body.data.lineup = (body.data.lineup as Obj[]).filter((l) => l.id !== 284);
    body.data.bowling = (body.data.bowling as Obj[]).filter((r) => r.player_id !== 284);
    const n = normalizeFixture(body, catalog);
    expect(player(n, '284').teamId).toBe('6'); // DC (3) batted in S2
    expect(player(n, '284').flags.map((f) => f.code)).toEqual(['bowling_card_mismatch']);
  });

  it('a 65610-style washout with every collection key absent normalizes to no players and no flags', () => {
    const body = structuredClone(m44);
    for (const k of ['lineup', 'batting', 'bowling', 'balls', 'runs', 'scoreboards']) delete body.data[k];
    const n = normalizeFixture(body, catalog);
    expect(n.meta.hasBallByBall).toBe(false);
    expect(n.players).toEqual([]);
    expect(n.flags).toEqual([]);
  });
});
