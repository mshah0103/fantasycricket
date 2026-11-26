import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFileArchive, type RawArchive } from '../src/archive.js';
import { SportmonksError, type SportmonksClient } from '../src/client.js';
import type { FixtureListing } from '../src/discover.js';
import { latestEntryForPath, pullHistory, pullSquads, resolveSquadTeamIds } from '../src/pull.js';

let archive: RawArchive;
let calls: string[];
let failing: Set<string>;
/** Fixture status served by the stub, per path; default Finished. */
let statusOf: Map<string, string>;

function stubClient(): SportmonksClient {
  return {
    async get(path, query) {
      calls.push(path);
      const fail = failing.has(path);
      const status = fail ? 500 : 200;
      const body = fail ? { error: 'x' } : { data: handler(path) };
      const entry = await archive.save(path, query ?? {}, status, body, new Date());
      if (fail) throw new SportmonksError('boom', 500, path);
      return { body, entry };
    },
  };
}

function handler(path: string): unknown {
  if (path === '/leagues') return [{ id: 8, name: 'Indian Premier League' }];
  if (path === '/seasons') return [{ id: 100, league_id: 8, name: '2024' }, { id: 200, league_id: 8, name: '2025' }];
  if (path === '/seasons/100') return { id: 100, fixtures: [{ id: 1, season_id: 100 }, { id: 2, season_id: 100 }] };
  if (path === '/seasons/200') return { id: 200, fixtures: { data: [{ id: 3, season_id: 200 }, { id: 4, season_id: 200 }] } };
  if (path.startsWith('/fixtures/')) return { id: Number(path.slice('/fixtures/'.length)), status: statusOf.get(path) ?? 'Finished' };
  return { id: path };
}

beforeEach(async () => {
  archive = createFileArchive(await mkdtemp(join(tmpdir(), 'pull-')));
  calls = [];
  failing = new Set();
  statusOf = new Map();
});

describe('pullHistory', () => {
  it('fetches /scores once plus every fixture', async () => {
    const r = await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    expect(r).toEqual({ fetched: 4, skipped: 0, failed: [] });
    expect(calls.filter((c) => c === '/scores')).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('/fixtures/')).sort()).toEqual(['/fixtures/1', '/fixtures/2', '/fixtures/3', '/fixtures/4']);
    expect(calls[0]).toBe('/scores');
  });

  it('respects the year range', async () => {
    const r = await pullHistory(stubClient(), archive, { fromYear: 2025, toYear: 2025 });
    expect(r.fetched).toBe(2);
  });

  it('resumes: second run skips everything', async () => {
    await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    calls = [];
    const lines: string[] = [];
    const r = await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025, log: (l) => lines.push(l) });
    expect(r).toEqual({ fetched: 0, skipped: 4, failed: [] });
    expect(calls.some((c) => c.startsWith('/fixtures/'))).toBe(false);
    expect(lines.filter((l) => /skipped/.test(l))).toHaveLength(4);
  });

  it('resumes only finished fixtures: one whose latest archived body is not finished is fetched again', async () => {
    statusOf.set('/fixtures/3', 'NS');
    statusOf.set('/fixtures/4', '2nd Innings');
    await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    statusOf.set('/fixtures/4', 'Finished');
    calls = [];
    const r = await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    expect(r).toEqual({ fetched: 2, skipped: 2, failed: [] });
    expect(calls.filter((c) => c.startsWith('/fixtures/')).sort()).toEqual(['/fixtures/3', '/fixtures/4']);
    // Only the latest body counts: 4 is now finished, 3 is still NS. Aban. (finished group) is done too.
    statusOf.set('/fixtures/3', 'Aban.');
    calls = [];
    expect(await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 })).toEqual({ fetched: 1, skipped: 3, failed: [] });
    expect(calls.filter((c) => c.startsWith('/fixtures/'))).toEqual(['/fixtures/3']);
    calls = [];
    expect(await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 })).toEqual({ fetched: 0, skipped: 4, failed: [] });
  });

  it('records a failing fixture and continues', async () => {
    failing.add('/fixtures/2');
    const r = await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    expect(r).toEqual({ fetched: 3, skipped: 0, failed: ['2'] });
    // a later run retries only the failed one (500 entries do not count as done)
    failing.clear();
    calls = [];
    const r2 = await pullHistory(stubClient(), archive, { fromYear: 2024, toYear: 2025 });
    expect(r2).toEqual({ fetched: 1, skipped: 3, failed: [] });
  });
});

describe('pullSquads', () => {
  it('requests each team squad', async () => {
    await pullSquads(stubClient(), '200', ['1', '2']);
    expect(calls).toEqual(['/teams/1/squad/200', '/teams/2/squad/200']);
  });
});

describe('resolveSquadTeamIds', () => {
  const fx = (local: string, visitor: string): FixtureListing => ({
    fixtureId: '1', seasonId: 's', startingAt: '', localTeamId: local, visitorTeamId: visitor, round: null, status: 'NS', superOver: false,
  });
  const s2025 = { year: 2025, seasonId: '1689', fixtures: [fx('10', '2'), fx('5', '10')] };
  const s2026 = { year: 2026, seasonId: '1795', fixtures: [fx('6', '2'), fx('7', '')] };
  const s2027 = { year: 2027, seasonId: '2001', fixtures: [] as FixtureListing[] };

  it("uses the requested season's fixture teams, distinct and sorted numerically", () => {
    expect(resolveSquadTeamIds({ year: 2025, seasons: [s2026, s2025] })).toEqual({
      teamIds: ['2', '5', '10'],
      source: { kind: 'season', year: 2025, seasonId: '1689' },
    });
  });

  it('a season with no fixtures falls back to the most recent season that has them', () => {
    expect(resolveSquadTeamIds({ year: 2027, seasons: [s2027, s2025, s2026] })).toEqual({
      teamIds: ['2', '6', '7'],
      source: { kind: 'fallback', year: 2026, seasonId: '1795' },
    });
    // Fixtures without team ids count as none.
    expect(resolveSquadTeamIds({ year: 2027, seasons: [{ ...s2027, fixtures: [fx('', '')] }, s2025] }).source).toEqual({ kind: 'fallback', year: 2025, seasonId: '1689' });
  });

  it('--teams overrides everything', () => {
    expect(resolveSquadTeamIds({ year: 2027, override: ['9', '3', '9'], seasons: [s2026] })).toEqual({ teamIds: ['3', '9'], source: { kind: 'override' } });
    expect(resolveSquadTeamIds({ year: 2027, override: ['4'], seasons: [] }).teamIds).toEqual(['4']);
  });

  it('throws a clear error when no team id is found', () => {
    expect(() => resolveSquadTeamIds({ year: 2027, seasons: [s2027] })).toThrow(/No team ids found for IPL 2027.*--teams/);
    expect(() => resolveSquadTeamIds({ year: 2027, seasons: [] })).toThrow(/--teams/);
  });
});

describe('latestEntryForPath', () => {
  it('returns the latest 2xx entry, ignoring failures and other paths', async () => {
    await archive.save('/fixtures/9', {}, 200, { v: 1 }, new Date('2026-01-01'));
    await archive.save('/fixtures/9', {}, 200, { v: 2 }, new Date('2026-01-02'));
    await archive.save('/fixtures/9', {}, 500, { v: 3 }, new Date('2026-01-03'));
    await archive.save('/fixtures/10', {}, 200, { v: 4 }, new Date('2026-01-04'));
    const e = await latestEntryForPath(archive, '/fixtures/9');
    expect(await archive.readBody(e!)).toEqual({ v: 2 });
    expect(await latestEntryForPath(archive, '/fixtures/77')).toBeUndefined();
  });
});
