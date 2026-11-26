import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLinks, linkPlayers, type SportmonksPlayerRef } from '../src/link.js';
import { normalizeCricsheetMatch, type CricsheetFixture } from '../src/normalize.js';

type Obj = Record<string, any>;
const m64 = JSON.parse(readFileSync(new URL('./fixtures/1473502.json', import.meta.url), 'utf8')) as Obj;

/** m64 cut down to the given Cricsheet players (LSG first, GT second), with no deliveries. */
function fixture(lsg: string[], gt: string[] = []): CricsheetFixture {
  const body = structuredClone(m64);
  body.info.players = { 'Lucknow Super Giants': lsg, 'Gujarat Titans': gt };
  for (const name of [...lsg, ...gt]) body.info.registry.people[name] ??= `id-${name.replace(/\W/g, '')}`;
  body.innings = [];
  return normalizeCricsheetMatch(body, { matchId: '9' });
}
const csId = (n: CricsheetFixture, name: string): string =>
  Object.entries(n.playerNames).find(([, v]) => v === name)![0];
const names = (n: CricsheetFixture, ids: Iterable<string>): string[] => [...ids].map((id) => n.playerNames[id]!);
const teamNames = new Map([
  ['1979', 'Lucknow Super Giants'],
  ['1976', 'Gujarat Titans'],
  ['7', 'Rajasthan Royals'],
]);
const sm = (id: string, name: string, teamId: string): SportmonksPlayerRef => ({ id, name, teamId });

describe('linkPlayers', () => {
  it('matches surname and first initial: "MR Marsh" is "Mitchell Marsh"', () => {
    const n = fixture(['MR Marsh']);
    const r = linkPlayers(n, [sm('31', 'Mitchell Marsh', '1979'), sm('5', 'Shaun Marsh', '7')]);
    expect(r).toEqual({ linked: new Map([[csId(n, 'MR Marsh'), '31']]), unresolved: [] });
  });

  it('full given names after the initials must be in the Sportmonks name ("M Shahrukh Khan" is not "Mohsin Khan")', () => {
    const n = fixture(['M Shahrukh Khan', 'B Sai Sudharsan', 'Akash Singh']);
    const pool = [sm('100', 'Mohsin Khan', '1979'), sm('8394', 'Akash Maharaj Singh', '1979'), sm('9', 'Himmat Singh', '1979')];
    expect(linkPlayers(n, pool)).toEqual({
      linked: new Map([[csId(n, 'Akash Singh'), '8394']]),
      unresolved: [csId(n, 'B Sai Sudharsan'), csId(n, 'M Shahrukh Khan')].sort(),
    });
    const r = linkPlayers(n, [...pool, sm('7668', 'Shahrukh Khan', '1976'), sm('28955', 'Sai Sudharsan', '1976')]);
    expect(r.unresolved).toEqual([]);
    expect(r.linked.get(csId(n, 'M Shahrukh Khan'))).toBe('7668');
    expect(r.linked.get(csId(n, 'B Sai Sudharsan'))).toBe('28955');
  });

  it('names compare without case, accents, apostrophes or hyphens', () => {
    const n = fixture(["W O'Rourke", 'J Fraser-McGurk']);
    const r = linkPlayers(n, [sm('10089', "William O'Rourke", '1979'), sm('4949', 'Jake Fraser-McGurk', '3')]);
    expect(names(n, r.linked.keys()).sort()).toEqual(['J Fraser-McGurk', "W O'Rourke"]);
  });

  it('several candidates: the one who played for the Cricsheet team wins; otherwise unresolved', () => {
    const n = fixture(['KV Sharma']);
    const id = csId(n, 'KV Sharma');
    const karn = sm('2999', 'Karn Sharma', '1979');
    const karan = sm('3001', 'Karan Sharma', '7');
    expect(linkPlayers(n, [karn, karan], { teamNames }).linked.get(id)).toBe('2999');
    // Without team names, or with both (or neither) on the Cricsheet team, there is no way to choose.
    expect(linkPlayers(n, [karn, karan])).toEqual({ linked: new Map(), unresolved: [id] });
    expect(linkPlayers(n, [karn, { ...karan, teamId: '1979' }], { teamNames }).unresolved).toEqual([id]);
    expect(linkPlayers(n, [{ ...karn, teamId: '7' }, karan], { teamNames }).unresolved).toEqual([id]);
    // One Sportmonks player listed under several teams is still one candidate, on any of his teams.
    expect(linkPlayers(n, [{ ...karn, teamId: '7' }, karn, karan], { teamNames }).linked.get(id)).toBe('2999');
  });

  it('no candidate is unresolved; two Cricsheet players on one Sportmonks id are both unresolved', () => {
    const n = fixture(['KL Rahul', 'MR Marsh'], ['M Marsh']);
    const r = linkPlayers(n, [sm('47', 'Lokesh Rahul', '3'), sm('31', 'Mitchell Marsh', '1979')]);
    expect(r.linked.size).toBe(0);
    expect(names(n, r.unresolved).sort()).toEqual(['KL Rahul', 'M Marsh', 'MR Marsh']);
  });
});

describe('linkPlayers: same-team surname fallback (twins only)', () => {
  const opts = { teamNames, sameTeamSurname: true };

  it('"KL Rahul" is "Lokesh Rahul": no name candidate, but the only Rahul on his team on both sides', () => {
    const n = fixture(['KL Rahul', 'MR Marsh']);
    const pool = [sm('47', 'Lokesh Rahul', '1979'), sm('31', 'Mitchell Marsh', '1979')];
    // Off by default: the first initials differ, so he is unresolved.
    expect(linkPlayers(n, pool, { teamNames }).unresolved).toEqual([csId(n, 'KL Rahul')]);
    expect(linkPlayers(n, pool, opts)).toEqual({ linked: new Map([[csId(n, 'MR Marsh'), '31'], [csId(n, 'KL Rahul'), '47']]), unresolved: [] });
    // A Rahul on the other team does not make the surname ambiguous on his.
    expect(linkPlayers(n, [...pool, sm('9', 'Rahul Tewatia', '1976'), sm('10', 'Ravi Rahul', '1976')], opts).linked.get(csId(n, 'KL Rahul'))).toBe('47');
  });

  it('a duplicate surname on the team, on either side, never links by surname', () => {
    // Sportmonks has two Pandyas on the team.
    const one = fixture(['ZZ Pandya']);
    expect(linkPlayers(one, [sm('1', 'Hardik Pandya', '1979'), sm('2', 'Krunal Pandya', '1979')], opts)).toEqual({ linked: new Map(), unresolved: [csId(one, 'ZZ Pandya')] });
    // Cricsheet has two Pandyas on the team: neither links, though Sportmonks has one.
    const two = fixture(['ZZ Pandya', 'YY Pandya']);
    expect(linkPlayers(two, [sm('1', 'Hardik Pandya', '1979')], opts).linked.size).toBe(0);
  });

  it('needs the Sportmonks player on the same team, and team names', () => {
    const n = fixture(['KL Rahul']);
    expect(linkPlayers(n, [sm('47', 'Lokesh Rahul', '1976')], opts).linked.size).toBe(0); // on GT, not LSG
    expect(linkPlayers(n, [sm('47', 'Lokesh Rahul', '1979')], { sameTeamSurname: true }).linked.size).toBe(0); // no team names
  });

  it('a surname link that claims an id another player links to is unresolved (both)', () => {
    const n = fixture(['KL Rahul'], ['L Rahul']);
    // "L Rahul" (GT) links to Lokesh Rahul by initial; "KL Rahul" (LSG) would take the same id by surname.
    const r = linkPlayers(n, [sm('47', 'Lokesh Rahul', '1979'), sm('47', 'Lokesh Rahul', '1976')], opts);
    expect(r.linked.size).toBe(0);
    expect(names(n, r.unresolved).sort()).toEqual(['KL Rahul', 'L Rahul']);
  });
});

describe('applyLinks', () => {
  it('replaces linked ids on records and flags, maps team ids by name, keeps cs: ids otherwise, re-sorts', () => {
    const body = structuredClone(m64);
    body.innings = [
      {
        team: 'Gujarat Titans',
        overs: [{ over: 0, deliveries: [{ batter: 'Shubman Gill', bowler: 'Avesh Khan', non_striker: 'JC Buttler', runs: { batter: 0, extras: 0, total: 0 }, wickets: [{ kind: 'run out', player_out: 'Shubman Gill', fielders: [{ name: 'MR Marsh' }] }] }] }],
      },
    ];
    const n = normalizeCricsheetMatch(body, { matchId: '9' });
    const gill = csId(n, 'Shubman Gill');
    const linked = new Map([[gill, '3362'], [csId(n, 'MR Marsh'), '31']]);
    const out = applyLinks(n, linked, { teamNames: new Map([['1976', 'Gujarat Titans']]) });

    expect(out.meta).toMatchObject({ localTeamId: 'cs:Lucknow Super Giants', visitorTeamId: '1976' });
    expect(out.players.find((p) => p.playerId === '3362')).toMatchObject({ teamId: '1976', fixtureId: 'cs:9' });
    expect(out.players.find((p) => p.playerId === '31')).toMatchObject({ teamId: 'cs:Lucknow Super Giants' });
    expect(out.flags).toEqual([expect.objectContaining({ code: 'runout_fielder_missing', playerId: '3362' })]);
    expect(out.players.find((p) => p.playerId === '3362')!.flags).toEqual(out.flags);
    expect(out.playerNames['3362']).toBe('Shubman Gill');
    expect(out.playerNames[gill]).toBeUndefined();
    // Numeric Sportmonks ids first (numerically), then cs: ids.
    const ids = out.players.map((p) => p.playerId);
    expect(ids.slice(0, 2)).toEqual(['31', '3362']);
    expect(ids.slice(2).every((id) => id.startsWith('cs:'))).toBe(true);
    // The input is not modified.
    expect(n.players.some((p) => p.playerId === gill)).toBe(true);
    expect(n.flags[0]!.playerId).toBe(gill);
  });
});
