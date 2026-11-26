import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlayerMatchStats } from '@fc/scoring';
import {
  buildScoreCatalog,
  dismissalKindFromScoreName,
  isSubstituteDismissal,
  phaseOfScoreboard,
  runOutCreditedFielder,
} from '../src/fieldMap.js';
import { fixtureMeta } from '../src/normalize/meta.js';
import { battingAndFielding } from '../src/normalize/batting.js';

type Obj = Record<string, any>;
const load = (name: string): Obj =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

const catalog = buildScoreCatalog(load('scores.json'));
const m64 = load('ipl2025-m64-gt-lsg.json'); // 65607
const m69 = load('ipl2025-m69-pbks-mi.json'); // 65603
const m32 = load('ipl2025-m32-dc-rr-superover.json'); // 65574
const m44 = load('ipl2025-m44-kkr-pbks-noresult.json'); // 65586
const m29 = load('ipl2025-fielding-sample.json'); // 65571
const ALL = { m64, m69, m32, m44, m29 };

const zeroFielding = { catches: 0, stumpings: 0, runOuts: 0 };

function player(players: Map<string, PlayerMatchStats>, id: string): PlayerMatchStats {
  const p = players.get(id);
  if (!p) throw new Error(`no record for player ${id}`);
  return p;
}

/** The batting record of `playerId` on `scoreboard` in a fixture body (for building synthetic variants). */
function battingRow(body: Obj, playerId: number, scoreboard = 'S1'): Obj {
  const row = (body.data.batting as Obj[]).find((b) => b.player_id === playerId && b.scoreboard === scoreboard);
  if (!row) throw new Error(`no batting row for ${playerId} on ${scoreboard}`);
  return row;
}

describe('fieldMap', () => {
  it('builds the /scores catalog keyed by string id', () => {
    expect(catalog.size).toBe(103);
    expect(catalog.get('54')).toEqual({ name: 'Catch Out' });
    expect(catalog.get('84')).toEqual({ name: 'Not Out' });
  });

  it('maps every FIELD_MAP §4 batting-record name', () => {
    const table: Record<string, string | null> = {
      'Catch Out': 'caught',
      'Catch Out (Sub)': 'caught',
      'Clean Bowled': 'bowled',
      Bowled: 'bowled',
      'LBW OUT': 'lbw',
      'Stump Out': 'stumped',
      'Stump Out (Sub)': 'stumped',
      '1 Wide + stump Out': 'stumped',
      'Hit Wicket': 'hit_wicket',
      'Run Out': 'run_out',
      'Run Out (Sub)': 'run_out',
      'Not Out': 'not_out',
      'Retired Hurt': 'retired_hurt',
      'Retired Out': 'retired_out',
      'Obstructing the Field Out': 'obstructing_field',
      Absent: null,
      'Absent Hurt': null,
      'Hit the ball twice': null,
      'Timed Out': null,
    };
    for (const [name, kind] of Object.entries(table)) expect([name, dismissalKindFromScoreName(name)]).toEqual([name, kind]);
  });

  it('detects substitute dismissals by the (Sub) suffix', () => {
    expect(isSubstituteDismissal('Catch Out (Sub)')).toBe(true);
    expect(isSubstituteDismissal('Run Out (Sub)')).toBe(true);
    expect(isSubstituteDismissal('Stump Out (Sub)')).toBe(true);
    expect(isSubstituteDismissal('Run Out + 1 Run (Sub)')).toBe(true);
    expect(isSubstituteDismissal('Catch Out')).toBe(false);
    expect(isSubstituteDismissal('Run Out')).toBe(false);
  });

  it('maps scoreboard codes to phases', () => {
    expect(phaseOfScoreboard('S1')).toBe('regulation');
    expect(phaseOfScoreboard('S2')).toBe('regulation');
    expect(phaseOfScoreboard('S3')).toBe('super_over');
    expect(phaseOfScoreboard('S4')).toBe('super_over');
    expect(phaseOfScoreboard('S6')).toBe('super_over');
    expect(() => phaseOfScoreboard('X1')).toThrow();
    expect(() => phaseOfScoreboard('S0')).toThrow();
  });

  it('credits a run-out to runout_by_id only (spec §5.6, FIELD_MAP §5.2)', () => {
    expect(runOutCreditedFielder({ runout_by_id: 662, catch_stump_player_id: 3806 })).toBe('662');
    expect(runOutCreditedFielder({ runout_by_id: null, catch_stump_player_id: 227 })).toBeNull();
  });
});

describe('fixtureMeta', () => {
  it('reads m64 metadata with string ids and UTC ISO start', () => {
    expect(fixtureMeta(m64)).toEqual({
      fixtureId: '65607',
      leagueId: '1',
      seasonId: '1689',
      startingAt: '2025-05-22T14:00:00.000Z',
      status: 'Finished',
      round: '64th Match',
      localTeamId: '1976',
      visitorTeamId: '1979',
      superOver: false,
      hasBallByBall: true,
    });
  });

  it('flags the m32 Super Over fixture', () => {
    expect(fixtureMeta(m32).superOver).toBe(true);
  });

  it('throws on a body that is not { data: {...} }', () => {
    expect(() => fixtureMeta({ nope: 1 })).toThrow();
  });
});

describe('battingAndFielding: golden cases', () => {
  it('m64: Marsh 117 off 64, 10x4, 8x6, out', () => {
    const { players } = battingAndFielding(m64, catalog);
    const marsh = player(players, '31');
    expect(marsh.fixtureId).toBe('65607');
    expect(marsh.teamId).toBe('1979');
    expect(marsh.regulation.batting).toMatchObject({ runs: 117, ballsFaced: 64, fours: 10, sixes: 8 });
    expect(marsh.regulation.batting!.dismissal).not.toBeNull();
    expect(marsh.regulation.batting!.dismissal).toBe('caught');
    expect(marsh.regulation.bowling).toBeNull();
    expect(marsh.superOver).toBeNull();
  });

  it('m69: Inglis 73 off 42, 9x4, 3x6 and 1 catch', () => {
    const { players } = battingAndFielding(m69, catalog);
    const inglis = player(players, '623');
    expect(inglis.regulation.batting).toEqual({ runs: 73, ballsFaced: 42, fours: 9, sixes: 3, dismissal: 'lbw' });
    expect(inglis.regulation.fielding.catches).toBe(1);
    expect(inglis.regulation.fielding).toEqual({ catches: 1, stumpings: 0, runOuts: 0 });
  });

  it('m32: Super Over batting is split from regulation', () => {
    const { players } = battingAndFielding(m32, catalog);
    const rahul = player(players, '47');
    const stubbs = player(players, '25797');
    const hetmyer = player(players, '108');
    const parag = player(players, '4922');

    expect(rahul.superOver?.batting).toMatchObject({ runs: 7, fours: 1 });
    expect(stubbs.superOver?.batting).toMatchObject({ runs: 6, sixes: 1 });
    expect(hetmyer.superOver?.batting).toMatchObject({ runs: 6, fours: 1 });
    expect(parag.superOver?.batting).toMatchObject({ runs: 4, fours: 1 });
    expect(parag.superOver?.batting?.dismissal).toBe('run_out');

    // Regulation excludes the Super Over (S1/S2 rows only).
    expect(rahul.regulation.batting).toMatchObject({ runs: 38, ballsFaced: 32, fours: 2, sixes: 2 });
    expect(stubbs.regulation.batting).toMatchObject({ runs: 34, ballsFaced: 18, fours: 2, sixes: 2 });
    expect(hetmyer.regulation.batting).toMatchObject({ runs: 15, ballsFaced: 9, fours: 1, sixes: 0 });
    expect(parag.regulation.batting).toMatchObject({ runs: 8, ballsFaced: 11, fours: 1, sixes: 0 });
  });

  it('m32: Super Over fielding lands in the Super Over phase; uninvolved players have superOver null', () => {
    const { players } = battingAndFielding(m32, catalog);
    // Starc (36): caught Jaiswal in S2; runout_by_id on both S3 run-outs (spec-literal credit).
    expect(player(players, '36').regulation.fielding).toEqual({ catches: 1, stumpings: 0, runOuts: 0 });
    expect(player(players, '36').superOver?.fielding).toEqual({ catches: 0, stumpings: 0, runOuts: 2 });
    expect(player(players, '36').superOver?.batting).toBeNull();
    // KL Rahul (47): runout_by_id for Jurel in S2; only catch_stump_player_id (uncredited) on Parag's S3 run-out.
    expect(player(players, '47').regulation.fielding.runOuts).toBe(1);
    expect(player(players, '47').superOver?.fielding).toEqual(zeroFielding);
    // Sanju Samson (2900): retired hurt in S2, no Super Over involvement.
    expect(player(players, '2900').regulation.batting?.dismissal).toBe('retired_hurt');
    expect(player(players, '2900').superOver).toBeNull();
  });

  it('m44 (abandoned, partial play): normalizes, both sides have batting, status is Aban.', () => {
    expect(fixtureMeta(m44).status).toBe('Aban.');
    const { players, flags } = battingAndFielding(m44, catalog);
    expect(flags).toEqual([]);
    expect(players.size).toBe(32);
    const all = [...players.values()];
    const pbks = all.filter((p) => p.teamId === '4' && p.regulation.batting);
    const kkr = all.filter((p) => p.teamId === '5' && p.regulation.batting);
    expect(pbks.length).toBe(6);
    expect(player(players, '6496').regulation.batting).toMatchObject({ runs: 83, ballsFaced: 49 });
    // KKR were 7/0 in S2: 5 batter runs (Gurbaz 1, Narine 4) + 1 wide + 1 leg-bye.
    expect(kkr.map((p) => p.playerId).sort()).toEqual(['344', '758']);
    expect(kkr.reduce((n, p) => n + p.regulation.batting!.runs, 0)).toBe(5);
  });
});

describe('battingAndFielding: synthetic variants', () => {
  it('washout: m44 with batting, bowling and balls emptied gives lineup players only, zeroed, no flags', () => {
    const washout = structuredClone(m44);
    washout.data.batting = [];
    washout.data.bowling = [];
    washout.data.balls = [];
    expect(fixtureMeta(washout).hasBallByBall).toBe(false);
    const { players, flags } = battingAndFielding(washout, catalog);
    expect(flags).toEqual([]);
    expect(players.size).toBe(washout.data.lineup.length);
    for (const p of players.values()) {
      expect(p.regulation).toEqual({ batting: null, bowling: null, fielding: zeroFielding });
      expect(p.superOver).toBeNull();
      expect(p.flags).toEqual([]);
    }
  });

  it('a fielder in neither lineup (999999) gets a record on the fielding team', () => {
    const body = structuredClone(m64);
    const row = battingRow(body, 31); // Marsh, LSG (1979), Catch Out by 128
    row.catch_stump_player_id = 999999;
    const { players } = battingAndFielding(body, catalog);
    const sub = player(players, '999999');
    expect(sub.teamId).toBe('1976'); // GT fielded while LSG batted
    expect(sub.regulation.fielding.catches).toBe(1);
    expect(sub.regulation.batting).toBeNull();
    expect(sub.superOver).toBeNull();
  });

  it('shape drift: a batting record without runs is one unparseable_record; every other batter is present', () => {
    const body = structuredClone(m64);
    delete battingRow(body, 66).score; // Markram
    const { players, flags } = battingAndFielding(body, catalog);
    const unparseable = flags.filter((f) => f.code === 'unparseable_record');
    expect(unparseable).toHaveLength(1);
    expect(unparseable[0]).toMatchObject({ fixtureId: '65607', playerId: '66' });
    expect(player(players, '66').flags).toEqual(unparseable);
    expect(player(players, '66').regulation.batting).toBeNull();
    const others = (m64.data.batting as Obj[]).filter((b) => b.player_id !== 66);
    expect(others).toHaveLength(13);
    for (const b of others) {
      expect(player(players, String(b.player_id)).regulation.batting?.runs).toBe(b.score);
    }
  });

  it('a batting record with an unknown scoreboard code is unparseable_record and skipped', () => {
    const body = structuredClone(m64);
    battingRow(body, 31).scoreboard = 'SO1';
    const { players, flags } = battingAndFielding(body, catalog);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['unparseable_record', '31']]);
    expect(flags[0]!.detail).toMatch(/scoreboard/);
    expect(player(players, '31').regulation.batting).toBeNull();
    expect(player(players, '128').regulation.fielding.catches).toBe(0); // the skipped record credits nobody
  });

  it('an unknown dismissal name gives unknown_dismissal and dismissal null', () => {
    const body = structuredClone(m64);
    battingRow(body, 31).score_id = 80; // Absent: no DismissalKind
    const { players, flags } = battingAndFielding(body, catalog);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['unknown_dismissal', '31']]);
    expect(player(players, '31').regulation.batting).toEqual({ runs: 117, ballsFaced: 64, fours: 10, sixes: 8, dismissal: null });
    expect(player(players, '31').flags).toHaveLength(1);
    expect(player(players, '128').regulation.fielding.catches).toBe(0); // no credit for an unknown kind
  });

  it('a substitute dismissal with no fielder id gives sub_fielder_unidentified and no credit', () => {
    const body = structuredClone(m64);
    battingRow(body, 128, 'S2').catch_stump_player_id = null; // Rutherford, Catch Out (Sub) by Bishnoi 9459
    const { players, flags } = battingAndFielding(body, catalog);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['sub_fielder_unidentified', '128']]);
    expect(player(players, '128').regulation.batting?.dismissal).toBe('caught');
    expect(player(players, '9459').regulation.fielding.catches).toBe(1); // was 2
  });

  it('a non-substitute catch with no fielder id is flagged unparseable_record but the batting still counts', () => {
    const body = structuredClone(m64);
    battingRow(body, 31).catch_stump_player_id = null;
    const { players, flags } = battingAndFielding(body, catalog);
    expect(flags.map((f) => [f.code, f.playerId])).toEqual([['unparseable_record', '31']]);
    expect(flags[0]!.detail).toMatch(/no fielder id/);
    expect(player(players, '31').regulation.batting).toEqual({ runs: 117, ballsFaced: 64, fours: 10, sixes: 8, dismissal: 'caught' });
    expect(player(players, '128').regulation.fielding.catches).toBe(0);
  });
});

describe('battingAndFielding: fielding sample (m29)', () => {
  it('two-fielder run-outs credit runout_by_id; one-fielder run-out is flagged with nobody credited', () => {
    const { players, flags } = battingAndFielding(m29, catalog);
    // Rickelton (662): runout_by_id on Ashutosh and Kuldeep (Run Out (Sub)); stumped Vipraj Nigam.
    expect(player(players, '662').regulation.fielding).toEqual({ catches: 0, stumpings: 1, runOuts: 2 });
    // Will Jacks (3806) threw for Ashutosh: catch_stump_player_id, not credited. He caught Fraser-McGurk.
    expect(player(players, '3806').regulation.fielding).toEqual({ catches: 1, stumpings: 0, runOuts: 0 });
    // Raj Angad Bawa (35051), the substitute in Kuldeep's Run Out (Sub): not credited.
    expect(player(players, '35051').regulation.fielding).toEqual(zeroFielding);
    // Mohit Sharma (2348): single-fielder run-out by Santner (227), runout_by_id null.
    expect(player(players, '227').regulation.fielding.runOuts).toBe(0);
    const missing = flags.filter((f) => f.code === 'runout_fielder_missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ fixtureId: '65571', playerId: '2348' });
    expect(missing[0]!.detail).toMatch(/227/);
    expect(missing[0]!.detail).toMatch(/S2/);
    expect(player(players, '2348').flags).toEqual(missing);
    expect(flags).toHaveLength(1);
  });

  it('caught and bowled: KL Rahul c & b Karn Sharma; the catch goes to the bowler', () => {
    const { players } = battingAndFielding(m29, catalog);
    expect(player(players, '47').regulation.batting?.dismissal).toBe('caught_and_bowled');
    expect(player(players, '2999').regulation.fielding.catches).toBe(1);
  });

  it('every run-out has exactly one credited fielder or a runout_fielder_missing flag (all fixtures)', () => {
    for (const [name, body] of Object.entries(ALL)) {
      const runOuts = (body.data.batting as Obj[]).filter(
        (b) => dismissalKindFromScoreName(catalog.get(String(b.score_id))?.name ?? '') === 'run_out',
      ).length;
      const { players, flags } = battingAndFielding(body, catalog);
      const credited = [...players.values()].reduce(
        (n, p) => n + p.regulation.fielding.runOuts + (p.superOver?.fielding.runOuts ?? 0),
        0,
      );
      const missing = flags.filter((f) => f.code === 'runout_fielder_missing').length;
      expect([name, credited + missing]).toEqual([name, runOuts]);
    }
  });

  it('a substitute fielder not in the lineup gets his own record', () => {
    const body = structuredClone(m64);
    battingRow(body, 7668, 'S2').catch_stump_player_id = 888888; // Shahrukh Khan, Catch Out (Sub) by Bishnoi
    const { players, flags } = battingAndFielding(body, catalog);
    expect(flags).toEqual([]);
    expect(player(players, '888888')).toMatchObject({ teamId: '1979', regulation: { fielding: { catches: 1 } } });
    expect(player(players, '9459').regulation.fielding.catches).toBe(1); // was 2
  });

  it('every lineup player has a record with the lineup team', () => {
    for (const body of Object.values(ALL)) {
      const { players } = battingAndFielding(body, catalog);
      for (const l of body.data.lineup as Obj[]) {
        expect(player(players, String(l.id)).teamId).toBe(String(l.lineup.team_id));
      }
    }
  });
});
