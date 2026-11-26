import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileArchive, type CricsheetLinks, type HistoryFixtureRecord, type RawArchive, type ScoredPlayerMatch, type SeasonCoverage } from '@fc/sportmonks';
import { identitiesFromTwins, importCricsheet } from '../src/import.js';
import { sportmonksLineupPlayers } from '../src/link.js';
import { normalizeCricsheetMatch } from '../src/normalize.js';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const loadSm = (file: string): unknown => JSON.parse(readFileSync(here(`../../sportmonks/test/fixtures/${file}`), 'utf8'));

let tmp: string;
let cricsheetDir: string;
let historyDir: string;
let archive: RawArchive;

const emptyCoverage = (year: number): SeasonCoverage => ({
  year, seasonId: '', fixturesListed: 0, fixturesFetched: 0, withBatting: 0, withBallByBall: 0, superOverFixtures: 0, flagsByCode: {},
});

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'cs-import-'));
  cricsheetDir = join(tmp, 'cricsheet', 'ipl_json');
  historyDir = join(tmp, 'history');
  mkdirSync(cricsheetDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });
  for (const f of ['1473502.json', '1473466.json']) copyFileSync(here(`./fixtures/${f}`), join(cricsheetDir, f));
  writeFileSync(join(cricsheetDir, 'README.txt'), 'not a match');
  // Sportmonks coverage that has no 2025 fixtures, so 2025 may be imported in this test.
  writeFileSync(join(historyDir, 'coverage.json'), JSON.stringify([emptyCoverage(2025)]));
  archive = createFileArchive(tmp);
  const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
  await archive.save('/fixtures/65607', {}, 200, loadSm('ipl2025-m64-gt-lsg.json'), t(1));
  await archive.save('/fixtures/65571', {}, 200, loadSm('ipl2025-fielding-sample.json'), t(2));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const read = (file: string) => readFileSync(join(historyDir, file), 'utf8');
const outputs = ['ipl-2025.jsonl', 'ipl-2025-fixtures.jsonl', 'coverage-cricsheet.json', 'cricsheet-unresolved.json', 'cricsheet-links.json'];
const jsonl = <T>(file: string): T[] => read(file).trim().split('\n').map((l) => JSON.parse(l) as T);

describe('identitiesFromTwins', () => {
  const m64 = () => normalizeCricsheetMatch(JSON.parse(readFileSync(here('./fixtures/1473502.json'), 'utf8')), { matchId: '1473502' });
  const lineup = (id: string) => ({ id, date: '2025-05-22', ...sportmonksLineupPlayers(loadSm('ipl2025-m64-gt-lsg.json')) });

  it('pairs a match with the Sportmonks fixture on its date that links the most players', () => {
    const { players, teamNames } = lineup('65607');
    const other = { id: '1', date: '2025-05-22', players: players.slice(0, 5) };
    const ev = identitiesFromTwins([m64()], { fixtures: [other, { id: '65607', date: '2025-05-22', players }], teamNames });
    expect(ev).toMatchObject({ twins: 1, ambiguous: [], unpaired: [] });
    expect(ev.identities.size).toBe(25);
    expect([...ev.identities.values()]).toContain('31');
  });

  it('a tie for the best fixture, or too few links, is no twin', () => {
    const { players, teamNames } = lineup('65607');
    const tie = identitiesFromTwins([m64()], { fixtures: [{ id: '1', date: '2025-05-22', players }, { id: '2', date: '2025-05-22', players }], teamNames });
    expect(tie).toMatchObject({ twins: 0, unpaired: [expect.stringMatching(/cs:1473502/)] });
    expect(tie.identities.size).toBe(0);
    const few = identitiesFromTwins([m64()], { fixtures: [{ id: '1', date: '2025-05-22', players: players.slice(0, 10) }], teamNames });
    expect(few.twins).toBe(0);
    expect(identitiesFromTwins([m64()], { fixtures: [{ id: '1', date: '2025-05-23', players }], teamNames })).toMatchObject({ twins: 0, unpaired: [] });
  });

  it('a Cricsheet player linked to two Sportmonks ids, or two players to one id, is ambiguous', () => {
    const { players, teamNames } = lineup('65607');
    const marsh = players.find((p) => p.id === '31')!;
    const second = { id: '2', date: '2025-05-24', players: [...players.filter((p) => p.id !== '31'), { ...marsh, id: '9031' }] };
    const later = m64();
    later.meta = { ...later.meta, startingAt: '2025-05-24T00:00:00.000Z' };
    const ev = identitiesFromTwins([m64(), later], { fixtures: [{ id: '65607', date: '2025-05-22', players }, second], teamNames });
    expect(ev.twins).toBe(2);
    expect(ev.ambiguous.map((id) => later.playerNames[id])).toEqual(['MR Marsh']);
    expect([...ev.identities.values()]).not.toContain('31');
  });
});

describe('importCricsheet', () => {
  it('writes the season file, Cricsheet coverage and the unresolved list; a re-run is byte-identical', async () => {
    const result = await importCricsheet({ cricsheetDir, historyDir, archive, years: [2025] });
    const rows = read('ipl-2025.jsonl').trim().split('\n').map((l) => JSON.parse(l) as ScoredPlayerMatch);

    // m29 (2025-04-13) before m64 (2025-05-22); within a fixture, by player id.
    expect([...new Set(rows.map((r) => r.meta.fixtureId))]).toEqual(['cs:1473466', 'cs:1473502']);
    expect(rows).toHaveLength(25 + 25);
    const marsh = rows.find((r) => r.meta.fixtureId === 'cs:1473502' && r.stats.playerId === '31')!;
    expect(marsh.score.totalHalfPoints).toBe(185);
    expect(marsh.stats.teamId).toBe('1979');
    for (const r of rows) expect(r.score.totalHalfPoints).toBe(r.score.components.reduce((s, c) => s + c.halfPoints, 0));

    const coverage = JSON.parse(read('coverage-cricsheet.json')) as SeasonCoverage[];
    expect(coverage).toEqual([
      {
        year: 2025,
        seasonId: 'cs:2025',
        fixturesListed: 2,
        fixturesFetched: 2,
        withBatting: 2,
        withBallByBall: 2,
        superOverFixtures: 0,
        flagsByCode: { runout_fielder_missing: 3 },
      },
    ]);
    expect(result.coverage).toEqual(coverage);
    // KL Rahul ("Lokesh Rahul" in Sportmonks) links in his twin by the same-team surname fallback.
    expect(JSON.parse(read('cricsheet-unresolved.json'))).toEqual([]);
    expect(rows.find((r) => r.meta.fixtureId === 'cs:1473466' && r.stats.playerId === '47')).toBeDefined();
    expect(rows.every((r) => !r.stats.playerId.startsWith('cs:'))).toBe(true);

    // The fixtures file: one line per match, same order, every flag; counts equal the coverage flags.
    const fixtures = jsonl<HistoryFixtureRecord>('ipl-2025-fixtures.jsonl');
    expect(fixtures.map((f) => f.meta.fixtureId)).toEqual(['cs:1473466', 'cs:1473502']);
    const counts: Record<string, number> = {};
    for (const f of fixtures) for (const fl of f.flags) counts[fl.code] = (counts[fl.code] ?? 0) + 1;
    expect(counts).toEqual(coverage[0]!.flagsByCode);
    // Flags are on Sportmonks ids, like the player lines.
    expect(fixtures.flatMap((f) => f.flags).every((fl) => fl.playerId === undefined || !fl.playerId.startsWith('cs:'))).toBe(true);

    const before = outputs.map(read);
    await importCricsheet({ cricsheetDir, historyDir, archive, years: [2025] });
    expect(outputs.map(read)).toEqual(before);
  });

  it('keeps other years in the Cricsheet coverage and unresolved files', async () => {
    writeFileSync(join(historyDir, 'coverage-cricsheet.json'), JSON.stringify([{ ...emptyCoverage(2008), seasonId: 'cs:2008' }]));
    writeFileSync(join(historyDir, 'cricsheet-unresolved.json'), JSON.stringify([{ year: 2008, csId: 'cs:x', name: 'X', team: 'T', matches: 1 }]));
    await importCricsheet({ cricsheetDir, historyDir, archive, years: [2025] });
    expect((JSON.parse(read('coverage-cricsheet.json')) as SeasonCoverage[]).map((c) => c.year)).toEqual([2008, 2025]);
    expect(JSON.parse(read('cricsheet-unresolved.json')).map((u: { year: number }) => u.year)).toEqual([2008]); // 2025: all linked
  });

  it('a season Sportmonks lacks takes ids only from Cricsheet registry ids seen in twins, never from a name alone', async () => {
    // A 2008 copy of m64 with one extra LSG player "R Bishnoi" under a new registry id: by name he could only be
    // Sportmonks' Ravi Bishnoi (9459), but that registry id never appears in a match both sources cover.
    const body = JSON.parse(readFileSync(here('./fixtures/1473502.json'), 'utf8'));
    body.info.dates = ['2008-04-20'];
    body.info.season = '2007/08';
    body.info.players['Lucknow Super Giants'].push('R Bishnoi');
    body.info.registry.people['R Bishnoi'] = 'feedf00d';
    writeFileSync(join(cricsheetDir, '2008001.json'), JSON.stringify(body));
    writeFileSync(join(historyDir, 'coverage.json'), JSON.stringify([emptyCoverage(2008), { ...emptyCoverage(2025), fixturesFetched: 74 }]));

    const result = await importCricsheet({ cricsheetDir, historyDir, archive, years: [2008] });
    expect(result.identities).toMatchObject({ twins: 2, ambiguous: [], unpaired: [] });
    expect(result.identities.identities.size).toBe(25 + 25); // m64 and m29 all (KL Rahul by surname in his twin)
    const rows = read('ipl-2008.jsonl').trim().split('\n').map((l) => JSON.parse(l) as ScoredPlayerMatch);
    expect(rows).toHaveLength(26);
    expect(rows.find((r) => r.stats.playerId === '31')!.score.totalHalfPoints).toBe(185); // Marsh, via his twin
    expect(rows.find((r) => r.stats.playerId === '9459')).toBeDefined(); // the real Ravi Bishnoi (sub fielder)
    expect(rows.find((r) => r.stats.playerId === 'cs:feedf00d')).toMatchObject({ stats: { teamId: '1979' } });
    expect(JSON.parse(read('cricsheet-unresolved.json'))).toEqual([{ year: 2008, csId: 'cs:feedf00d', name: 'R Bishnoi', team: 'Lucknow Super Giants', matches: 1 }]);
    expect(result.summary).toEqual([{ year: 2008, matches: 1, players: 26, linked: 25, unresolved: 1 }]);
    // 2025 (Sportmonks' year) is evidence only: nothing is written for it.
    expect(existsSync(join(historyDir, 'ipl-2025.jsonl'))).toBe(false);
  });

  it('cricsheet-links.json: twins, per-year counts and unresolved players who also play in Sportmonks seasons', async () => {
    // A 2008 copy of m29 with one extra DC player, also added to the 2025 m29 (where no Sportmonks player
    // matches him), and one extra MI player who never plays from 2013 on.
    const m29 = JSON.parse(readFileSync(here('./fixtures/1473466.json'), 'utf8'));
    m29.info.players['Delhi Capitals'].push('QZ Crossera');
    m29.info.registry.people['QZ Crossera'] = 'c0ffee00';
    writeFileSync(join(cricsheetDir, '1473466.json'), JSON.stringify(m29));
    const old = structuredClone(m29);
    old.info.dates = ['2008-04-20'];
    old.info.season = '2007/08';
    old.info.players['Mumbai Indians'].push('QZ Oldtimer');
    old.info.registry.people['QZ Oldtimer'] = 'oldf00d0';
    writeFileSync(join(cricsheetDir, '2008001.json'), JSON.stringify(old));
    writeFileSync(join(historyDir, 'coverage.json'), JSON.stringify([emptyCoverage(2008), { ...emptyCoverage(2025), fixturesFetched: 74 }]));
    // A row of a year not imported now is kept.
    writeFileSync(join(historyDir, 'cricsheet-links.json'), JSON.stringify({ perYear: [{ year: 2009, players: 1, linked: 0, unresolved: 1 }] }));

    const result = await importCricsheet({ cricsheetDir, historyDir, archive, years: [2008] });
    const links = JSON.parse(read('cricsheet-links.json')) as CricsheetLinks;
    expect(links).toEqual({
      twinsUsed: 2,
      identitiesLinked: 25 + 25,
      perYear: [
        { year: 2008, players: 27, linked: 25, unresolved: 2 }, // m29 has 25 players (one a substitute fielder) + 2
        { year: 2009, players: 1, linked: 0, unresolved: 1 },
      ],
      crossEraUnresolved: [{ csId: 'cs:c0ffee00', name: 'QZ Crossera', team: 'Delhi Capitals', years: [2008] }],
    });
    expect(result.links).toEqual(links);
    const before = read('cricsheet-links.json');
    await importCricsheet({ cricsheetDir, historyDir, archive, years: [2008] });
    expect(read('cricsheet-links.json')).toBe(before);
  });

  it('refuses a year that has Sportmonks fixtures, before writing anything', async () => {
    writeFileSync(join(historyDir, 'coverage.json'), JSON.stringify([{ ...emptyCoverage(2025), seasonId: '1689', fixturesFetched: 74 }]));
    await expect(importCricsheet({ cricsheetDir, historyDir, archive, years: [2025] })).rejects.toThrow(/2025.*Sportmonks/);
    for (const f of outputs) expect(existsSync(join(historyDir, f))).toBe(false);
  });

  it('refuses without a Sportmonks coverage.json', async () => {
    rmSync(join(historyDir, 'coverage.json'));
    await expect(importCricsheet({ cricsheetDir, historyDir, archive, years: [2025] })).rejects.toThrow(/coverage\.json/);
  });
});
