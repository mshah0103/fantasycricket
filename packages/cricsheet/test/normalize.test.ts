import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlayerMatchStats } from '@fc/scoring';
import { normalizeCricsheetMatch, type CricsheetFixture } from '../src/normalize.js';

type Obj = Record<string, any>;
const load = (name: string): Obj =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

const m64 = load('1473502.json'); // IPL 2025 m64 GT v LSG (Sportmonks 65607)
const m29 = load('1473466.json'); // IPL 2025 m29 DC v MI (Sportmonks 65571), the fielding sample

/** The record of the player Cricsheet calls `name`. */
function byName(n: CricsheetFixture, name: string): PlayerMatchStats {
  const ids = Object.entries(n.playerNames).filter(([, v]) => v === name).map(([k]) => k);
  if (ids.length !== 1) throw new Error(`expected one player named ${name}, found ${ids.length}`);
  const p = n.players.find((x) => x.playerId === ids[0]);
  if (!p) throw new Error(`no record for ${name}`);
  return p;
}

/** A delivery: `{ batter, bowler, non_striker, runs, ... }`. */
const delivery = (batter: string, bowler: string, nonStriker: string, runs: Obj, extra: Obj = {}): Obj => ({
  batter,
  bowler,
  non_striker: nonStriker,
  runs: { extras: 0, ...runs },
  ...extra,
});

describe('normalizeCricsheetMatch: IPL 2025 match 64 (GT v LSG)', () => {
  const n = normalizeCricsheetMatch(m64, { matchId: '1473502' });

  it('Marsh: 117 off 64 with 10 fours and 8 sixes, caught (spec §5.9 golden case)', () => {
    expect(byName(n, 'MR Marsh').regulation.batting).toEqual({ runs: 117, ballsFaced: 64, fours: 10, sixes: 8, dismissal: 'caught' });
  });

  it('meta: cs: ids, the date at UTC midnight, the match number as the round', () => {
    expect(n.meta).toEqual({
      fixtureId: 'cs:1473502',
      leagueId: 'cs:ipl',
      seasonId: 'cs:2025',
      startingAt: '2025-05-22T00:00:00.000Z',
      status: 'Finished',
      round: 'Match 64',
      localTeamId: 'cs:Lucknow Super Giants',
      visitorTeamId: 'cs:Gujarat Titans',
      superOver: false,
      hasBallByBall: true,
    });
  });

  it('without a match id the fixture id is a date-and-teams slug', () => {
    expect(normalizeCricsheetMatch(m64).meta.fixtureId).toBe('cs:2025-05-22-lucknow-super-giants-gujarat-titans');
  });

  it('one record per info.players entry plus the substitute fielder, ids from the registry, sorted', () => {
    expect(n.players).toHaveLength(25);
    const people = m64.info.registry.people as Record<string, string>;
    expect(byName(n, 'MR Marsh').playerId).toBe(`cs:${people['MR Marsh']}`);
    expect(byName(n, 'MR Marsh').teamId).toBe('cs:Lucknow Super Giants');
    expect(byName(n, 'B Sai Sudharsan').teamId).toBe('cs:Gujarat Titans');
    // Ravi Bishnoi is not in info.players: two catches as a substitute, on the fielding team.
    const bishnoi = byName(n, 'Ravi Bishnoi');
    expect(bishnoi).toMatchObject({ teamId: 'cs:Lucknow Super Giants', regulation: { batting: null, bowling: null } });
    expect(bishnoi.regulation.fielding).toEqual({ catches: 2, stumpings: 0, runOuts: 0 });
    const ids = n.players.map((p) => p.playerId);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of n.players) expect(p.fixtureId).toBe('cs:1473502');
  });

  it('bowling agrees with the Sportmonks bowling card (legal balls, runs conceded, wickets)', () => {
    // Card: O'Rourke 4-0-27-3, Akash Maharaj Singh 3.1-0-29-1, Avesh Khan 3.5-0-51-2, Arshad Khan 3-0-36-1 (1 no-ball).
    expect(byName(n, "W O'Rourke").regulation.bowling).toMatchObject({ legalBalls: 24, runsConceded: 27, wickets: 3 });
    expect(byName(n, 'Akash Singh').regulation.bowling).toMatchObject({ legalBalls: 19, runsConceded: 29, wickets: 1 });
    expect(byName(n, 'Avesh Khan').regulation.bowling).toMatchObject({ legalBalls: 23, runsConceded: 51, wickets: 2 });
    expect(byName(n, 'Arshad Khan').regulation.bowling).toMatchObject({ legalBalls: 18, runsConceded: 36, wickets: 1, noBallDeliveries: 1 });
    // Ball-by-ball is always there, so the per-delivery fields are never null.
    for (const p of n.players) {
      const b = p.regulation.bowling;
      if (b) for (const v of [b.dots, b.maidens, b.wideDeliveries, b.noBallDeliveries]) expect(v).not.toBeNull();
    }
  });

  it('players who did not bat have batting null; nobody has a Super Over phase; no flags', () => {
    expect(byName(n, 'Mohammed Siraj').regulation.batting).toBeNull();
    expect(n.players.every((p) => p.superOver === null)).toBe(true);
    expect(n.flags).toEqual([]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(normalizeCricsheetMatch(m64, { matchId: '1473502' }))).toBe(JSON.stringify(n));
  });
});

describe('normalizeCricsheetMatch: IPL 2025 match 29 (fielding sample)', () => {
  const n = normalizeCricsheetMatch(m29, { matchId: '1473466' });

  it('no run-out is credited (Task 12 ruling): each is flagged runout_fielder_missing on the batter, naming every fielder', () => {
    for (const p of n.players) expect(p.regulation.fielding.runOuts).toBe(0);
    expect(n.flags.map((f) => f.code)).toEqual(['runout_fielder_missing', 'runout_fielder_missing', 'runout_fielder_missing']);
    const byBatter = new Map(n.flags.map((f) => [n.playerNames[f.playerId!], f]));
    expect([...byBatter.keys()]).toEqual(['Ashutosh Sharma', 'Kuldeep Yadav', 'MM Sharma']);
    expect(byBatter.get('Ashutosh Sharma')!.detail).toMatch(/RD Rickelton.*WG Jacks/);
    expect(byBatter.get('Kuldeep Yadav')!.detail).toMatch(/RA Bawa.*substitute.*RD Rickelton/);
    expect(byBatter.get('MM Sharma')!.detail).toMatch(/MJ Santner/);
    for (const f of n.flags) {
      expect(f.fixtureId).toBe('cs:1473466');
      expect(byName(n, n.playerNames[f.playerId!]!).flags).toContainEqual(f);
    }
    // Run out without facing a ball is still a dismissal (duck rule applies in the engine).
    expect(byName(n, 'MM Sharma').regulation.batting).toMatchObject({ runs: 0, dismissal: 'run_out' });
  });

  it('the substitute in a run-out still gets a record, on the fielding team, with nothing credited', () => {
    expect(byName(n, 'RA Bawa')).toMatchObject({
      teamId: 'cs:Mumbai Indians',
      regulation: { batting: null, bowling: null, fielding: { catches: 0, stumpings: 0, runOuts: 0 } },
    });
  });

  it('caught and bowled: the bowler gets the wicket and the catch', () => {
    expect(byName(n, 'KL Rahul').regulation.batting?.dismissal).toBe('caught_and_bowled');
    const karn = byName(n, 'KV Sharma');
    expect(karn.regulation.fielding.catches).toBe(1);
    expect(karn.regulation.bowling?.wickets).toBe(3);
  });

  it('a stumping off a wide: keeper gets the stumping, bowler the wicket, the wide is not a ball faced', () => {
    expect(byName(n, 'RD Rickelton').regulation.fielding).toEqual({ catches: 0, stumpings: 1, runOuts: 0 });
    // Sportmonks card: Santner 4-0-43-2, 3 wide runs (balls: 6.4 `1 Wide`, 17.5 `1 Wide + stump Out`, 17.5 `1 Wide`).
    expect(byName(n, 'MJ Santner').regulation.bowling).toMatchObject({ legalBalls: 24, runsConceded: 43, wickets: 2, wideDeliveries: 3 });
    expect(byName(n, 'V Nigam').regulation.batting?.dismissal).toBe('stumped');
  });

  it('an all-run four (runs.non_boundary) is not a boundary four', () => {
    // Naman Dhir 19.6 off Mukesh Kumar: 4 runs, non_boundary.
    const plain = structuredClone(m29);
    for (const ov of plain.innings[0].overs) for (const d of ov.deliveries) delete d.runs.non_boundary;
    const before = byName(n, 'Naman Dhir').regulation.batting!;
    const after = byName(normalizeCricsheetMatch(plain), 'Naman Dhir').regulation.batting!;
    expect(after.fours).toBe(before.fours + 1);
    expect(after.runs).toBe(before.runs);
  });
});

describe('normalizeCricsheetMatch: delivery semantics (FIELD_MAP §6.2 / spec §5)', () => {
  /** A one-over match: LSG bat, Siraj bowls the given deliveries to Marsh and Markram. */
  function oneOver(deliveries: Obj[], inningsExtra: Obj[] = []): CricsheetFixture {
    const body = structuredClone(m64);
    body.innings = [{ team: 'Lucknow Super Giants', overs: [{ over: 0, deliveries }] }, ...inningsExtra];
    return normalizeCricsheetMatch(body, { matchId: '1' });
  }
  const M = 'MR Marsh';
  const K = 'AK Markram';
  const S = 'Mohammed Siraj';

  it('wides, no-balls, byes and leg-byes: what the batter and the bowler are charged', () => {
    const n = oneOver([
      delivery(M, S, K, { batter: 0, extras: 5, total: 5 }, { extras: { wides: 5 } }), // 5 wides: bowler 5, not faced
      delivery(M, S, K, { batter: 4, extras: 1, total: 5 }, { extras: { noballs: 1 } }), // no-ball + four: faced, a four
      delivery(M, S, K, { batter: 0, extras: 2, total: 2 }, { extras: { legbyes: 2 } }), // legal, not a dot, not charged
      delivery(M, S, K, { batter: 0, extras: 4, total: 4 }, { extras: { noballs: 1, byes: 3 } }), // no-ball + 3 byes: 1 charged
      delivery(M, S, K, { batter: 0, total: 0 }), // dot
      delivery(M, S, K, { batter: 6, total: 6 }), // six
      delivery(M, S, K, { batter: 0, extras: 5, total: 5 }, { extras: { penalty: 5 } }), // penalty: legal, not charged, not a dot
      delivery(M, S, K, { batter: 1, total: 1 }),
      delivery(K, S, M, { batter: 0, total: 0 }), // dot
    ]);
    expect(byName(n, M).regulation.batting).toEqual({ runs: 11, ballsFaced: 7, fours: 1, sixes: 1, dismissal: null });
    expect(byName(n, K).regulation.batting).toEqual({ runs: 0, ballsFaced: 1, fours: 0, sixes: 0, dismissal: null });
    expect(byName(n, S).regulation.bowling).toEqual({
      legalBalls: 6,
      runsConceded: 5 + 5 + 1 + 6 + 1,
      wickets: 0,
      dots: 2,
      maidens: 0,
      wideDeliveries: 1,
      noBallDeliveries: 2,
    });
  });

  it('a maiden: six legal balls with nothing charged to the bowler (leg-byes do not spoil it)', () => {
    const n = oneOver([
      delivery(M, S, K, { batter: 0, total: 0 }),
      delivery(M, S, K, { batter: 0, extras: 1, total: 1 }, { extras: { legbyes: 1 } }),
      delivery(K, S, M, { batter: 0, total: 0 }),
      delivery(K, S, M, { batter: 0, extras: 4, total: 4 }, { extras: { byes: 4 } }),
      delivery(K, S, M, { batter: 0, total: 0 }),
      delivery(K, S, M, { batter: 0, total: 0 }, { wickets: [{ player_out: K, kind: 'bowled' }] }),
    ]);
    expect(byName(n, S).regulation.bowling).toMatchObject({ legalBalls: 6, runsConceded: 0, wickets: 1, dots: 4, maidens: 1 });
  });

  it('dismissal kinds: bowler credit, the duck-relevant kinds, and retired hurt', () => {
    const n = oneOver([
      delivery(M, S, K, { batter: 0, total: 0 }, { wickets: [{ player_out: M, kind: 'hit wicket' }] }),
      delivery(K, S, 'N Pooran', { batter: 0, total: 0 }, { wickets: [{ player_out: 'N Pooran', kind: 'obstructing the field' }] }),
      delivery(K, S, 'RR Pant', { batter: 0, total: 0 }, { wickets: [{ player_out: 'RR Pant', kind: 'retired out' }] }),
      delivery(K, S, 'A Badoni', { batter: 1, total: 1 }, { wickets: [{ player_out: K, kind: 'retired hurt' }] }),
    ]);
    expect(byName(n, M).regulation.batting?.dismissal).toBe('hit_wicket');
    expect(byName(n, 'N Pooran').regulation.batting).toEqual({ runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissal: 'obstructing_field' });
    expect(byName(n, 'RR Pant').regulation.batting?.dismissal).toBe('retired_out');
    expect(byName(n, K).regulation.batting?.dismissal).toBe('retired_hurt');
    expect(byName(n, 'A Badoni').regulation.batting).toMatchObject({ runs: 0, ballsFaced: 0, dismissal: null });
    expect(byName(n, S).regulation.bowling?.wickets).toBe(1);
    expect(n.flags).toEqual([]);
  });

  it('a Super Over innings (super_over: true) goes to the superOver phase; meta.superOver is set', () => {
    const n = oneOver(
      [delivery(M, S, K, { batter: 4, total: 4 })],
      [
        { team: 'Lucknow Super Giants', super_over: true, overs: [{ over: 0, deliveries: [delivery(K, S, M, { batter: 6, total: 6 })] }] },
        {
          team: 'Gujarat Titans',
          super_over: true,
          overs: [{ over: 0, deliveries: [delivery('Shubman Gill', 'Avesh Khan', 'JC Buttler', { batter: 0, total: 0 }, { wickets: [{ player_out: 'Shubman Gill', kind: 'caught', fielders: [{ name: 'MR Marsh' }] }] })] }],
        },
      ],
    );
    expect(n.meta.superOver).toBe(true);
    expect(byName(n, K).regulation.batting).toMatchObject({ runs: 0, ballsFaced: 0 });
    expect(byName(n, K).superOver?.batting).toMatchObject({ runs: 6, ballsFaced: 1, sixes: 1 });
    expect(byName(n, S).regulation.bowling).toMatchObject({ legalBalls: 1, runsConceded: 4 });
    expect(byName(n, S).superOver?.bowling).toMatchObject({ legalBalls: 1, runsConceded: 6 });
    expect(byName(n, 'Avesh Khan').superOver?.bowling).toMatchObject({ legalBalls: 1, wickets: 1, dots: 1 });
    expect(byName(n, 'Avesh Khan').regulation.bowling).toBeNull();
    expect(byName(n, M).superOver?.fielding.catches).toBe(1);
    expect(byName(n, M).regulation.fielding.catches).toBe(0);
    expect(byName(n, 'Shubman Gill').superOver?.batting?.dismissal).toBe('caught');
    expect(byName(n, 'Mohammed Siraj').superOver?.batting ?? null).toBeNull();
    expect(byName(n, 'Rashid Khan').superOver).toBeNull();
  });

  it('a caught without a fielder, an unnamed or unregistered substitute, an unknown kind: flagged, never credited', () => {
    const n = oneOver([
      delivery(M, S, K, { batter: 0, total: 0 }, { wickets: [{ player_out: M, kind: 'caught' }] }),
      delivery(K, S, 'N Pooran', { batter: 0, total: 0 }, { wickets: [{ player_out: K, kind: 'caught', fielders: [{ substitute: true }] }] }),
      delivery('N Pooran', S, 'RR Pant', { batter: 0, total: 0 }, { wickets: [{ player_out: 'N Pooran', kind: 'stumped', fielders: [{ name: 'Nobody Known', substitute: true }] }] }),
      delivery('RR Pant', S, 'A Badoni', { batter: 0, total: 0 }, { wickets: [{ player_out: 'RR Pant', kind: 'hit the ball twice' }] }),
    ]);
    expect(n.flags.map((f) => [f.code, n.playerNames[f.playerId!]])).toEqual([
      ['unparseable_record', M],
      ['sub_fielder_unidentified', K],
      ['sub_fielder_unidentified', 'N Pooran'],
      ['unknown_dismissal', 'RR Pant'],
    ]);
    // The batting still counts; the bowler keeps the wickets that the kinds credit to him.
    expect(byName(n, M).regulation.batting?.dismissal).toBe('caught');
    expect(byName(n, 'RR Pant').regulation.batting?.dismissal).toBeNull();
    expect(byName(n, S).regulation.bowling?.wickets).toBe(3);
    expect(n.players.reduce((k, p) => k + p.regulation.fielding.catches + p.regulation.fielding.stumpings, 0)).toBe(0);
    for (const f of n.flags) {
      expect(f.fixtureId).toBe('cs:1');
      expect(byName(n, n.playerNames[f.playerId!]!).flags).toContainEqual(f);
    }
  });

  it('status "No result", a playoff stage as the round, and no deliveries', () => {
    const body = structuredClone(m64);
    body.info.outcome = { result: 'no result' };
    body.info.event = { name: 'Indian Premier League', stage: 'Qualifier 1' };
    body.innings = [];
    const n = normalizeCricsheetMatch(body, { matchId: '2' });
    expect(n.meta).toMatchObject({ status: 'No result', round: 'Qualifier 1', hasBallByBall: false, superOver: false });
    expect(n.players).toHaveLength(24);
    expect(n.players.every((p) => p.regulation.batting === null && p.regulation.bowling === null)).toBe(true);
  });

  it('the year comes from the first date, not the season label', () => {
    const body = structuredClone(m64);
    body.info.season = '2007/08';
    body.info.dates = ['2008-04-18'];
    expect(normalizeCricsheetMatch(body).meta).toMatchObject({ seasonId: 'cs:2008', startingAt: '2008-04-18T00:00:00.000Z' });
  });

  it('throws on a body that is not a Cricsheet match', () => {
    expect(() => normalizeCricsheetMatch({ info: {} })).toThrow(/Cricsheet/);
    expect(() => normalizeCricsheetMatch(null)).toThrow(/Cricsheet/);
  });
});
