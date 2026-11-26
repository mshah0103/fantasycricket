import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scorePlayerMatch, type BowlingStats } from '@fc/scoring';
import { buildScoreCatalog } from '../src/fieldMap.js';
import { fixtureMeta } from '../src/normalize/meta.js';
import { battingAndFielding } from '../src/normalize/batting.js';
import { bowlingFromBalls } from '../src/normalize/bowling.js';
import { normalizeFixture } from '../src/normalize/index.js';

type Obj = Record<string, any>;
const load = (name: string): Obj =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

const scores = load('scores.json');
const catalog = buildScoreCatalog(scores);
const m64 = load('ipl2025-m64-gt-lsg.json'); // 65607
const m63 = load('ipl2025-m63-mi-dc.json'); // 65608
const m69 = load('ipl2025-m69-pbks-mi.json'); // 65603
const m32 = load('ipl2025-m32-dc-rr-superover.json'); // 65574
const m44 = load('ipl2025-m44-kkr-pbks-noresult.json'); // 65586
const m29 = load('ipl2025-fielding-sample.json'); // 65571
const ALL = { m64, m63, m69, m32, m44, m29 };

/** The `/scores` catalog object with this id, as embedded on `balls[].score`. */
function scoreObj(id: number): Obj {
  const s = (scores.data as Obj[]).find((x) => x.id === id);
  if (!s) throw new Error(`no score ${id}`);
  return { resource: 'scores', ...s };
}
const NO_RUN = 82;
const LEG_BYE_1 = 4;

/** The ball records on `scoreboard` at over index `over` (mutable, for synthetic variants). */
function overBalls(body: Obj, scoreboard: string, over: number): Obj[] {
  return (body.data.balls as Obj[]).filter((b) => b.scoreboard === scoreboard && Math.floor(b.ball) === over);
}

function bowling(body: Obj, playerId: string, phase: 'regulation' | 'superOver'): BowlingStats | null {
  return bowlingFromBalls(body).byPlayerPhase.get(playerId)?.[phase] ?? null;
}

/** The one ball record of `bowlerId` on `scoreboard` numbered `ball` (mutable, for synthetic variants). */
function ballAt(body: Obj, scoreboard: string, bowlerId: number, ball: number): Obj {
  const found = (body.data.balls as Obj[]).filter((b) => b.scoreboard === scoreboard && b.bowler_id === bowlerId && b.ball === ball);
  if (found.length !== 1) throw new Error(`expected one ball ${scoreboard} ${ball} by ${bowlerId}, found ${found.length}`);
  return found[0]!;
}

/** Replaces a ball's score with the catalog entry `id`, checking the name so the table stays readable. */
function setScore(ball: Obj, id: number, name: string): void {
  ball.score = scoreObj(id);
  ball.score_id = id;
  expect(ball.score.name).toBe(name);
}

const cardOnly = (legalBalls: number, runsConceded: number, wickets: number): BowlingStats => ({
  legalBalls,
  runsConceded,
  wickets,
  dots: null,
  maidens: null,
  wideDeliveries: null,
  noBallDeliveries: null,
});

describe('bowlingFromBalls: real fixtures', () => {
  it('m63: Bumrah 3/12, 20 legal balls, 12 dots', () => {
    const { byPlayerPhase } = bowlingFromBalls(m63);
    const bumrah = byPlayerPhase.get('284');
    expect(bumrah?.regulation).toMatchObject({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 });
    expect(bumrah?.regulation).toEqual({
      legalBalls: 20,
      runsConceded: 12,
      wickets: 3,
      dots: 12,
      maidens: 0,
      wideDeliveries: 0,
      noBallDeliveries: 0,
    });
    expect(bumrah?.superOver).toBeNull();
  });

  it('m32: Sandeep Sharma Super Over 4 legal, 13 conceded, 0 dots, separate from regulation', () => {
    const sandeep = bowlFromBallsOf(m32, '2966');
    expect(sandeep.superOver).toMatchObject({ legalBalls: 4, runsConceded: 13, dots: 0 });
    expect(sandeep.superOver).toMatchObject({ wickets: 0, maidens: 0, wideDeliveries: 0, noBallDeliveries: 0 });
    // Regulation S1: card 4 ov, 33 runs, 0 wkts, wide 5 (runs), noball 1. The 3.1 run-out is a dot, not a wicket.
    expect(sandeep.regulation).toEqual({
      legalBalls: 24,
      runsConceded: 33,
      wickets: 0,
      dots: 7,
      maidens: 0,
      wideDeliveries: 5,
      noBallDeliveries: 1,
    });
  });

  it('m32: Starc Super Over has the no-ball and counts the 0-run run-out as a dot (FIELD_MAP §10)', () => {
    expect(bowling(m32, '36', 'superOver')).toEqual({
      legalBalls: 5,
      runsConceded: 11,
      wickets: 0,
      dots: 2,
      maidens: 0,
      wideDeliveries: 0,
      noBallDeliveries: 1,
    });
  });

  it('m69: Vyshak has 3 wide deliveries; card wide 7 is wide runs, so no mismatch flag', () => {
    const { byPlayerPhase, flags } = bowlingFromBalls(m69);
    expect(byPlayerPhase.get('46736')?.regulation).toMatchObject({ legalBalls: 24, runsConceded: 44, wickets: 2, wideDeliveries: 3 });
    expect(flags).toEqual([]);
  });

  it('m44: Arshdeep phantom 0-over card row is bowling null, with no flag', () => {
    const { byPlayerPhase, flags } = bowlingFromBalls(m44);
    expect(byPlayerPhase.get('4880')?.regulation ?? null).toBeNull();
    expect(byPlayerPhase.get('4880')?.superOver ?? null).toBeNull();
    expect(flags).toEqual([]);
    // KKR's one over before rain: Arshdeep's team-mate 6478 bowled it (card 1 ov, 6 runs, wide 1).
    expect(bowling(m44, '6478', 'regulation')).toMatchObject({ legalBalls: 6, runsConceded: 6, wideDeliveries: 1 });
  });

  it('every real fixture reconciles with its bowling card: no flags, card totals reproduced', () => {
    for (const [name, body] of Object.entries(ALL)) {
      const { byPlayerPhase, flags } = bowlingFromBalls(body);
      expect([name, flags]).toEqual([name, []]);
      for (const row of body.data.bowling as Obj[]) {
        const phase = Number(String(row.scoreboard).slice(1)) <= 2 ? 'regulation' : 'superOver';
        const got = byPlayerPhase.get(String(row.player_id))?.[phase] ?? null;
        if (row.overs === 0 && row.runs === 0) {
          expect([name, row.player_id, got]).toEqual([name, row.player_id, null]);
          continue;
        }
        const legal = Math.floor(row.overs) * 6 + Math.round((row.overs % 1) * 10);
        expect([name, row.player_id, got?.legalBalls, got?.runsConceded, got?.wickets, got?.maidens, got?.noBallDeliveries]).toEqual([
          name,
          row.player_id,
          legal,
          row.runs,
          row.wickets,
          row.medians,
          row.noball,
        ]);
      }
    }
  });
});

/** Both phases of one bowler from `bowlingFromBalls`, failing if he has no entry. */
function bowlFromBallsOf(body: Obj, playerId: string) {
  const b = bowlingFromBalls(body).byPlayerPhase.get(playerId);
  if (!b) throw new Error(`no bowling for ${playerId}`);
  return b;
}

describe('bowlingFromBalls: maidens (grouped by scoreboard, over and bowler)', () => {
  it('spec §5.9: an over of 6 legal balls with 2 leg-byes and nothing else is a maiden with 4 dots', () => {
    const body = structuredClone(m63);
    const over = overBalls(body, 'S2', 6); // Bumrah 6.1–6.6: 4 dots, a four and a single
    expect(over.map((b) => b.bowler_id)).toEqual([284, 284, 284, 284, 284, 284]);
    over.forEach((b, i) => {
      b.score = scoreObj(i === 1 || i === 4 ? LEG_BYE_1 : NO_RUN);
      b.score_id = b.score.id;
    });
    const { byPlayerPhase } = bowlingFromBalls(body);
    // The over had 4 dots before and still has 4 (the leg-byes are not dots); 5 runs fewer conceded.
    expect(byPlayerPhase.get('284')?.regulation).toMatchObject({ legalBalls: 20, runsConceded: 7, wickets: 3, dots: 12, maidens: 1 });
  });

  it('an over split between two bowlers is a maiden for neither', () => {
    const body = structuredClone(m64);
    const over = overBalls(body, 'S2', 5); // 5.1 by 8394, 5.2–5.6 by 3152
    expect(over.map((b) => b.bowler_id)).toEqual([8394, 3152, 3152, 3152, 3152, 3152]);
    for (const b of over) {
      b.score = scoreObj(NO_RUN);
      b.score_id = NO_RUN;
    }
    const { byPlayerPhase } = bowlingFromBalls(body);
    expect(byPlayerPhase.get('8394')?.regulation?.maidens).toBe(0);
    expect(byPlayerPhase.get('3152')?.regulation?.maidens).toBe(0);
  });
});

describe('bowlingFromBalls: per-delivery classification (synthetic edits on m63)', () => {
  // Bumrah's S2 6.1 is a legal "No Run" (a dot). Each case replaces that one ball and pins his whole line.
  // Unedited: 20 legal, 12 conceded, 3 wickets, 12 dots, no wides, no no-balls, no maidens.
  const line = (legalBalls: number, runsConceded: number, wickets: number, dots: number, wideDeliveries: number): BowlingStats => ({
    legalBalls,
    runsConceded,
    wickets,
    dots,
    maidens: 0,
    wideDeliveries,
    noBallDeliveries: 0,
  });
  const cases: Array<[number, string, string, BowlingStats]> = [
    [21, '1 Wide + stump Out', 'bowler wicket and a wide delivery, not a legal ball', line(19, 13, 4, 11, 1)],
    [20, '1 Wide + Hit Wicket', 'bowler wicket and a wide delivery, not a legal ball', line(19, 13, 4, 11, 1)],
    [87, 'Hit Wicket', 'bowler wicket on a legal ball, and a 0-run wicket is a dot', line(20, 12, 4, 12, 0)],
    [65, 'Run Out + 1 Run', 'no bowler wicket; the completed run is charged and spoils the dot', line(20, 13, 3, 11, 0)],
    [22, '1 Wide + Run Out', 'no bowler wicket; a wide delivery', line(19, 13, 3, 11, 1)],
    [1, '1 Bye', 'legal ball, not a dot, the bye not charged to the bowler', line(20, 12, 3, 11, 0)],
    // Controller ruling (review Minor 1): runs off a wide are wides, byes included -> 1 + 4 charged.
    [18, '1 Wide + 4 Bye', 'a wide delivery; its bye runs are charged to the bowler', line(19, 17, 3, 11, 1)],
  ];

  it.each(cases)('score %i "%s": %s', (id, name, _what, expected) => {
    const body = structuredClone(m63);
    setScore(ballAt(body, 'S2', 284, 6.1), id, name);
    expect(bowling(body, '284', 'regulation')).toEqual(expected);
  });

  it('a bowler with only wides and no-balls: 0 legal balls, extras counted, finite score with only the per-delivery penalties', () => {
    const body = structuredClone(m63);
    const template = ballAt(body, 'S2', 284, 18.2);
    // Corbin Bosch (4337), an MI substitute with no other involvement, bowls four illegal deliveries.
    const extras: Array<[number, string]> = [
      [17, '1 Wide'],
      [52, '5 Wides'],
      [7, '1 No Ball'],
      [13, '1 No Ball + Four'],
    ];
    extras.forEach(([id, name], i) => {
      const b = structuredClone(template);
      delete b.bowler;
      Object.assign(b, { id: 99_000_000 + i, bowler_id: 4337, batsmanout_id: null, catchstump_id: null, runout_by_id: null });
      setScore(b, id, name);
      (body.data.balls as Obj[]).push(b);
    });

    expect(bowling(body, '4337', 'regulation')).toEqual({
      legalBalls: 0,
      runsConceded: 12, // 1 + 5 + 1 + (1 no-ball + 4)
      wickets: 0,
      dots: 0,
      maidens: 0,
      wideDeliveries: 2,
      noBallDeliveries: 2,
    });

    const bosch = normalizeFixture(body, catalog).players.find((p) => p.playerId === '4337')!;
    expect(bosch.flags.map((f) => f.code)).toEqual(['bowling_card_mismatch']); // balls, no card row
    const result = scorePlayerMatch(bosch);
    expect(Number.isFinite(result.totalHalfPoints)).toBe(true);
    expect(result.components).toEqual([
      { phase: 'regulation', code: 'bowl_wides', quantity: 2, halfPoints: -4 },
      { phase: 'regulation', code: 'bowl_noballs', quantity: 2, halfPoints: -8 },
    ]);
    expect(result.components.map((c) => c.code)).not.toContain('bowl_economy');
    expect(result.totalHalfPoints).toBe(-12);
  });
});

describe('bowlingFromBalls: card fallback and reconciliation', () => {
  it('missing balls key: m64 without balls gives card bowling, null dots and a ball_data_missing flag per bowler', () => {
    const body = structuredClone(m64);
    delete body.data.balls;
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    // Card S2 8394: 3.1 ov, 29 runs, 1 wkt.
    expect(byPlayerPhase.get('8394')?.regulation).toEqual(cardOnly(19, 29, 1));
    expect(byPlayerPhase.get('8394')?.regulation?.dots).toBeNull();
    const bowlers = (m64.data.bowling as Obj[]).map((r) => String(r.player_id));
    expect(bowlers).toHaveLength(12);
    expect(flags.map((f) => f.code)).toEqual(bowlers.map(() => 'ball_data_missing'));
    expect(flags.map((f) => f.playerId)).toEqual(bowlers);
    expect(flags.every((f) => f.fixtureId === '65607')).toBe(true);
    for (const row of m64.data.bowling as Obj[]) {
      const legal = Math.floor(row.overs) * 6 + Math.round((row.overs % 1) * 10);
      expect(byPlayerPhase.get(String(row.player_id))?.regulation).toEqual(cardOnly(legal, row.runs, row.wickets));
    }
  });

  it('missing keys do not throw: no balls gives hasBallByBall false; a 65610-style body has no bowling', () => {
    const body = structuredClone(m64);
    delete body.data.balls;
    expect(fixtureMeta(body).hasBallByBall).toBe(false);
    expect(() => battingAndFielding(body, catalog)).not.toThrow();

    const washout = structuredClone(m64);
    for (const k of ['lineup', 'batting', 'bowling', 'balls', 'runs', 'scoreboards']) delete washout.data[k];
    expect(fixtureMeta(washout).hasBallByBall).toBe(false);
    expect(battingAndFielding(washout, catalog)).toEqual({ players: new Map(), flags: [] });
    expect(bowlingFromBalls(washout)).toEqual({ byPlayerPhase: new Map(), flags: [] });
  });

  it('per-bowler gap (65546 shape): a carded bowler with no balls gets card values and ball_data_missing; others unaffected', () => {
    const body = structuredClone(m63);
    body.data.balls = (body.data.balls as Obj[]).filter((b) => b.bowler_id !== 227); // Santner: S2 4 ov, 11 runs, 3 wkts
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    expect(byPlayerPhase.get('227')?.regulation).toEqual(cardOnly(24, 11, 3));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: 'ball_data_missing', fixtureId: '65608', playerId: '227' });
    expect(byPlayerPhase.get('284')?.regulation).toEqual(bowlFromBallsOf(m63, '284').regulation);
  });

  it('card disagrees with balls: ball-derived values kept, bowling_card_mismatch with both sets', () => {
    const body = structuredClone(m63);
    const row = (body.data.bowling as Obj[]).find((r) => r.player_id === 284)!;
    row.runs = 13;
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    expect(byPlayerPhase.get('284')?.regulation).toMatchObject({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: 'bowling_card_mismatch', fixtureId: '65608', playerId: '284' });
    expect(flags[0]!.detail).toMatch(/\b12\b/);
    expect(flags[0]!.detail).toMatch(/\b13\b/);
  });

  it('card wide is compared with wide runs and card noball with no-ball deliveries', () => {
    const body = structuredClone(m69);
    (body.data.bowling as Obj[]).find((r) => r.player_id === 46736)!.wide = 3; // deliveries, not runs
    const { flags } = bowlingFromBalls(body);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['bowling_card_mismatch', '46736']]);

    const nb = structuredClone(m63);
    (nb.data.bowling as Obj[]).find((r) => r.player_id === 284)!.noball = 1;
    expect(bowlingFromBalls(nb).flags.map((f) => [f.code, f.playerId])).toEqual([['bowling_card_mismatch', '284']]);
  });

  it('balls for a bowler with no card row (2019 fixtures 9968, 10004): ball-derived values and bowling_card_mismatch', () => {
    const body = structuredClone(m63);
    body.data.bowling = (body.data.bowling as Obj[]).filter((r) => r.player_id !== 284);
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    expect(byPlayerPhase.get('284')?.regulation).toMatchObject({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 });
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['bowling_card_mismatch', '284']]);
  });

  it('an inconsistent catalog score (id 106) on a ball is unparseable_record and the ball is skipped', () => {
    const body = structuredClone(m63);
    const ball = (body.data.balls as Obj[]).find((b) => b.scoreboard === 'S2' && b.bowler_id === 284 && b.ball === 18.1)!;
    ball.score = scoreObj(106); // "3 No ball": runs 3, noball_runs 2
    ball.score_id = 106;
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([
      ['unparseable_record', '284'],
      ['bowling_card_mismatch', '284'],
    ]);
    expect(flags[0]!.detail).toMatch(/106/);
    // 18.1 was a legal single: without it, 19 legal balls and 11 runs.
    expect(byPlayerPhase.get('284')?.regulation).toMatchObject({ legalBalls: 19, runsConceded: 11, wickets: 3, dots: 12 });
  });

  it('a ball record that fails its schema is unparseable_record, flagged on its bowler', () => {
    const body = structuredClone(m63);
    const ball = (body.data.balls as Obj[]).find((b) => b.scoreboard === 'S2' && b.bowler_id === 284 && b.ball === 18.1)!;
    delete ball.score;
    const { flags } = bowlingFromBalls(body);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([
      ['unparseable_record', '284'],
      ['bowling_card_mismatch', '284'],
    ]);
  });
});

describe('bowlingFromBalls: Super Over detail missing (R9)', () => {
  it('m32 with every S3/S4 record removed (2013–2017 shape): one fixture-level ball_data_missing naming innings 3 and 4', () => {
    const body = structuredClone(m32);
    for (const k of ['batting', 'bowling', 'balls', 'scoreboards']) {
      body.data[k] = (body.data[k] as Obj[]).filter((r) => r.scoreboard === 'S1' || r.scoreboard === 'S2');
    }
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: 'ball_data_missing', fixtureId: '65574' });
    expect(flags[0]!.playerId).toBeUndefined();
    expect(flags[0]!.detail).toMatch(/3/);
    expect(flags[0]!.detail).toMatch(/4/);
    expect(byPlayerPhase.get('2966')?.superOver).toBeNull();
    expect(byPlayerPhase.get('36')?.superOver).toBeNull();
  });

  it('m32 with only the Super Over balls removed: card fallback per bowler plus the fixture-level flag', () => {
    const body = structuredClone(m32);
    body.data.balls = (body.data.balls as Obj[]).filter((b) => b.scoreboard === 'S1' || b.scoreboard === 'S2');
    const { byPlayerPhase, flags } = bowlingFromBalls(body);
    // Card S3 Starc 0.5 ov, 11 runs; S4 Sandeep 0.4 ov, 13 runs.
    expect(byPlayerPhase.get('36')?.superOver).toEqual(cardOnly(5, 11, 0));
    expect(byPlayerPhase.get('2966')?.superOver).toEqual(cardOnly(4, 13, 0));
    expect(byPlayerPhase.get('2966')?.regulation).toMatchObject({ legalBalls: 24, runsConceded: 33, dots: 7 });
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([
      ['ball_data_missing', '36'],
      ['ball_data_missing', '2966'],
      ['ball_data_missing', undefined],
    ]);
  });
});
