import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFileArchive, type RawArchive } from '../src/archive.js';
import { SportmonksError, type SportmonksClient } from '../src/client.js';
import { latestEntryForPath, pullHistory, pullSquads } from '../src/pull.js';

let archive: RawArchive;
let calls: string[];
let failing: Set<string>;

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
  return { id: path };
}

beforeEach(async () => {
  archive = createFileArchive(await mkdtemp(join(tmpdir(), 'pull-')));
  calls = [];
  failing = new Set();
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
