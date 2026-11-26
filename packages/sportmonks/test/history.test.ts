import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileArchive, type RawArchive } from '../src/archive.js';
import { buildHistory, type ScoredPlayerMatch } from '../src/history.js';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

let tmp: string;
let out: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'history-'));
  out = join(tmp, 'out');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

async function seed(archive: RawArchive): Promise<void> {
  const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
  await archive.save('/scores', {}, 200, load('scores.json'), t(0));
  await archive.save('/fixtures/65607', {}, 200, load('ipl2025-m64-gt-lsg.json'), t(1));
  await archive.save('/fixtures/65574', {}, 200, load('ipl2025-m32-dc-rr-superover.json'), t(2));
  await archive.save('/fixtures/65586', {}, 200, load('ipl2025-m44-kkr-pbks-noresult.json'), t(3));
}

const readLines = (file: string): ScoredPlayerMatch[] =>
  readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as ScoredPlayerMatch);

describe('buildHistory', () => {
  it('writes ipl-2025.jsonl and coverage with the expected counts', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    const coverage = await buildHistory(archive, out);

    expect(coverage).toHaveLength(1);
    expect(coverage[0]).toMatchObject({
      year: 2025,
      fixturesFetched: 3,
      withBatting: 3,
      withBallByBall: 3,
      superOverFixtures: 1,
    });
    const lines = readLines(join(out, 'ipl-2025.jsonl'));
    expect(lines.length).toBeGreaterThan(3 * 11);
    expect(new Set(lines.map((l) => l.meta.fixtureId))).toEqual(new Set(['65607', '65574', '65586']));
    for (const l of lines) expect(l.score.totalHalfPoints).toBe(l.score.components.reduce((s, c) => s + c.halfPoints, 0));
    expect(JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8'))).toEqual(coverage);
  });

  it('m44 players carry only what was played: S1 for PBKS, 5 batter runs for KKR openers, no Super Over', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    await buildHistory(archive, out);
    const m44 = readLines(join(out, 'ipl-2025.jsonl')).filter((l) => l.meta.fixtureId === '65586');
    expect(m44.length).toBeGreaterThan(11);
    for (const l of m44) expect(l.stats.superOver).toBeNull();
    const batters = m44.filter((l) => l.stats.regulation.batting);
    // PBKS (visitor, team 4) batted S1; KKR (local, team 5) has only the two openers from S2.
    expect(m44[0]!.meta.visitorTeamId).toBe('4');
    expect(batters.filter((l) => l.stats.teamId === '4')).toHaveLength(6);
    expect(batters.filter((l) => l.stats.teamId === '5')).toHaveLength(2);
    const byTeam = new Map<string, number>();
    for (const l of batters) byTeam.set(l.stats.teamId, (byTeam.get(l.stats.teamId) ?? 0) + l.stats.regulation.batting!.runs);
    const totals = [...byTeam.values()].sort((a, b) => a - b);
    expect(totals[0]).toBe(5);
    expect(totals[1]).toBeGreaterThan(100);
  });

  it('a second run produces byte-identical files', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    await buildHistory(archive, out);
    const snap = () => readdirSync(out).sort().map((f) => [f, readFileSync(join(out, f), 'utf8')]);
    const first = snap();
    await buildHistory(archive, out);
    expect(snap()).toEqual(first);
  });

  it('uses the latest body per fixture and ignores non-IPL leagues when /leagues is archived', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    await archive.save('/leagues', {}, 200, { data: [{ id: 1, name: 'Indian Premier League' }, { id: 5, name: 'Big Bash' }] }, new Date(Date.UTC(2026, 0, 2)));
    const bbl = structuredClone(load('ipl2025-m64-gt-lsg.json')) as { data: { id: number; league_id: number } };
    bbl.data.id = 99999;
    bbl.data.league_id = 5;
    await archive.save('/fixtures/99999', {}, 200, bbl, new Date(Date.UTC(2026, 0, 3)));
    const coverage = await buildHistory(archive, out);
    expect(coverage[0]!.fixturesFetched).toBe(3);
  });

  it('lists missing years in coverage when a range is given', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    const coverage = await buildHistory(archive, out, { fromYear: 2024, toYear: 2026 });
    expect(coverage.map((c) => c.year)).toEqual([2024, 2025, 2026]);
    expect(coverage[0]).toEqual({ year: 2024, seasonId: '', fixturesListed: 0, fixturesFetched: 0, withBatting: 0, withBallByBall: 0, superOverFixtures: 0, flagsByCode: {} });
    expect(readdirSync(out).sort()).toEqual(['coverage.json', 'ipl-2025.jsonl']);
  });

  it('counts a whole-fixture failure as fixture_unparseable and reports it', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    await archive.save('/fixtures/77777', {}, 200, { data: { id: 77777, league_id: 1, season_id: 1689, starting_at: '2025-04-01T14:00:00Z' } }, new Date(Date.UTC(2026, 0, 4)));
    const errors: string[] = [];
    const coverage = await buildHistory(archive, out, { onFixtureError: (id) => errors.push(id) });
    expect(errors).toEqual(['77777']);
    expect(coverage[0]!.flagsByCode.fixture_unparseable).toBe(1);
    expect(coverage[0]!.fixturesFetched).toBe(4);
    expect(coverage[0]!.withBallByBall).toBe(3);
  });

  it('reports a fixture with no resolvable year and writes nothing for it', async () => {
    const archive = createFileArchive(tmp);
    await seed(archive);
    await archive.save('/fixtures/88888', {}, 200, { data: { id: 88888 } }, new Date(Date.UTC(2026, 0, 4)));
    const errors: string[] = [];
    const coverage = await buildHistory(archive, out, { onFixtureError: (id) => errors.push(id) });
    expect(errors).toEqual(['88888']);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]!.fixturesFetched).toBe(3);
    expect(readdirSync(out).sort()).toEqual(['coverage.json', 'ipl-2025.jsonl']);
  });
});
