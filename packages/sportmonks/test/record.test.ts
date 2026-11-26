import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ArchiveEntry } from '../src/archive.js';
import { SportmonksError, type SportmonksClient } from '../src/client.js';
import { statusGroup } from '../src/fieldMap.js';
import { nextPollDelayMs, readRecording, recordFixture } from '../src/record.js';

const MIN = 60_000;
const START = new Date('2026-12-20T09:00:00.000Z');
const at = (offsetMin: number) => new Date(START.getTime() + offsetMin * MIN);

describe('statusGroup', () => {
  it('maps documented statuses; unknown strings are live', () => {
    expect(statusGroup('NS')).toBe('pre');
    expect(statusGroup('Delayed')).toBe('pre');
    for (const s of ['1st Innings', '2nd Innings', 'Innings Break', 'Int.', 'Tea Break', 'Stump Day 3']) expect(statusGroup(s)).toBe('live');
    for (const s of ['Finished', 'Aban.', 'Cancl.', 'Postp.']) expect(statusGroup(s)).toBe('finished');
    expect(statusGroup('Something New')).toBe('live');
  });
});

describe('nextPollDelayMs', () => {
  it('follows the spec §11 schedule', () => {
    expect(nextPollDelayMs(at(-90), START, 'NS', null)).toBe(30 * MIN);
    expect(nextPollDelayMs(at(-30), START, 'NS', null)).toBe(300_000);
    expect(nextPollDelayMs(at(10), START, '1st Innings', null)).toBe(30_000);
    const fin = at(200);
    expect(nextPollDelayMs(new Date(fin.getTime() + 60 * MIN), START, 'Finished', fin)).toBe(600_000);
    expect(nextPollDelayMs(new Date(fin.getTime() + 180 * MIN), START, 'Finished', fin)).toBeNull();
  });

  it('boundaries and edge cases', () => {
    expect(nextPollDelayMs(at(-60), START, 'NS', null)).toBe(300_000);
    const fin = at(200);
    expect(nextPollDelayMs(new Date(fin.getTime() + 120 * MIN), START, 'Finished', fin)).toBe(600_000);
    expect(nextPollDelayMs(new Date(fin.getTime() + 120 * MIN + 1), START, 'Finished', fin)).toBeNull();
    expect(nextPollDelayMs(at(10), START, 'NS', null)).toBe(300_000);
    expect(nextPollDelayMs(at(10), START, 'Delayed', null)).toBe(300_000);
    expect(nextPollDelayMs(at(10), START, 'Weird', null)).toBe(30_000);
    expect(nextPollDelayMs(at(300), START, 'Finished', null)).toBe(600_000);
  });
});

function snapshot(status: string, opts: { lineup?: number; balls?: number } = {}) {
  return {
    data: {
      id: 777,
      status,
      starting_at: START.toISOString(),
      lineup: Array.from({ length: opts.lineup ?? 0 }, (_, i) => ({ id: i + 1 })),
      balls: Array.from({ length: opts.balls ?? 0 }, (_, i) => ({ id: i + 1 })),
    },
  };
}

describe('recordFixture', () => {
  it('polls on schedule, archives each snapshot, writes timeline, and stops 2 h after finish', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rec-'));
    let clock = at(-120).getTime();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    };
    const script: (unknown | Error)[] = [
      snapshot('NS'),
      snapshot('NS', { lineup: 22 }),
      snapshot('1st Innings', { lineup: 22, balls: 3 }),
      new SportmonksError('boom', 503, '/fixtures/:id'),
      snapshot('1st Innings', { lineup: 22, balls: 6 }),
      snapshot('Finished', { lineup: 22, balls: 240 }),
      ...Array.from({ length: 13 }, () => snapshot('Finished', { lineup: 22, balls: 240 })),
    ];
    const calls: { path: string; query?: Record<string, string> }[] = [];
    const client: SportmonksClient = {
      async get(path, query) {
        calls.push({ path, query });
        const next = script.shift();
        if (next === undefined) throw new Error('script exhausted');
        if (next instanceof Error) throw next;
        const entry = { endpoint: path, params: query ?? {}, fetchedAt: new Date(clock).toISOString(), status: 200, file: 'x' } as ArchiveEntry;
        return { body: next, entry };
      },
    };
    const logs: string[] = [];
    await recordFixture(client, '777', dir, { now: () => new Date(clock), sleep, log: (l) => logs.push(l) });

    expect(calls[0]!.path).toBe('/fixtures/777');
    expect(calls[0]!.query!.include).toContain('balls');
    // poll1 at -120: wait to -60 (60m); poll2 at -60: 5m; poll3 at -55: 30s; error: 30s; poll at ~-54: 30s; Finished: 10m x 13 then stop.
    expect(sleeps.slice(0, 5)).toEqual([60 * MIN, 5 * MIN, 30_000, 30_000, 30_000]);
    expect(sleeps.slice(5)).toEqual(Array(13).fill(10 * MIN));
    expect(script).toHaveLength(0);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.json.gz')).sort();
    expect(files).toHaveLength(18);
    const body1 = JSON.parse(gunzipSync(await readFile(join(dir, '1.json.gz'))).toString());
    expect(body1.data.status).toBe('NS');

    const lines = (await readFile(join(dir, 'timeline.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(19);
    expect(lines[0]).toMatchObject({ seq: 1, status: 'NS', lineupPresent: false, ballsCount: 0 });
    expect(lines[1]).toMatchObject({ seq: 2, status: 'NS', lineupPresent: true });
    expect(lines[2]).toMatchObject({ seq: 3, status: '1st Innings', ballsCount: 3 });
    expect(lines[3]).toMatchObject({ seq: null, error: 'boom' });
    expect(lines[4]).toMatchObject({ seq: 4, ballsCount: 6 });
    expect(lines[5]).toMatchObject({ seq: 5, status: 'Finished' });
    expect(logs.length).toBeGreaterThan(0);

    const seqs: number[] = [];
    for await (const s of readRecording(dir)) seqs.push(s.seq);
    expect(seqs).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('flags unknown statuses, propagates non-Sportmonks errors, and resumes from an existing timeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rec-'));
    let clock = at(10).getTime();
    const mk = (script: (unknown | Error)[]): SportmonksClient => ({
      async get(path, query) {
        const next = script.shift()!;
        if (next instanceof Error) throw next;
        return { body: next, entry: { endpoint: path, params: query ?? {}, fetchedAt: new Date(clock).toISOString(), status: 200, file: 'x' } as ArchiveEntry };
      },
    });
    const sleep = async (ms: number) => {
      clock += ms;
    };
    await expect(recordFixture(mk([snapshot('Weird Status'), new TypeError('bug')]), '777', dir, { now: () => new Date(clock), sleep })).rejects.toThrow('bug');
    let lines = (await readFile(join(dir, 'timeline.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ seq: 1, status: 'Weird Status', unknownStatus: true });

  });

  it('a restarted recorder resumes seq numbering and its 2 h window from timeline.jsonl', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rec-'));
    const clock = at(400).getTime();
    const old = { seq: 7, fetchedAt: at(200).toISOString(), status: 'Finished', lineupPresent: true, ballsCount: 240 };
    await writeFile(join(dir, 'timeline.jsonl'), JSON.stringify(old) + '\n');
    const sleeps: number[] = [];
    const client: SportmonksClient = {
      async get(path, query) {
        return {
          body: snapshot('Finished', { lineup: 22 }),
          entry: { endpoint: path, params: query ?? {}, fetchedAt: new Date(clock).toISOString(), status: 200, file: 'x' } as ArchiveEntry,
        };
      },
    };
    await recordFixture(client, '777', dir, { now: () => new Date(clock), sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([]); // 200 minutes after the original finish: window over, stop after one poll
    const lines = (await readFile(join(dir, 'timeline.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.seq)).toEqual([7, 8]);
    expect(existsSync(join(dir, '8.json.gz'))).toBe(true);
  });

  it('fails fast on a 401 (error line written, no sleep) but keeps retrying 503s, logging each failure', async () => {
    const mkClient = (script: (unknown | Error)[], clock: () => number): SportmonksClient => ({
      async get(path, query) {
        const next = script.shift()!;
        if (next instanceof Error) throw next;
        return { body: next, entry: { endpoint: path, params: query ?? {}, fetchedAt: new Date(clock()).toISOString(), status: 200, file: 'x' } as ArchiveEntry };
      },
    });
    const dir1 = await mkdtemp(join(tmpdir(), 'rec-'));
    const sleeps1: number[] = [];
    await expect(
      recordFixture(mkClient([new SportmonksError('Sportmonks /fixtures/:id responded with HTTP 401', 401, '/fixtures/:id')], () => 0), '777', dir1, {
        now: () => new Date(0),
        sleep: async (ms) => void sleeps1.push(ms),
      }),
    ).rejects.toThrow(/777.*401/);
    expect(sleeps1).toEqual([]);
    const l1 = (await readFile(join(dir1, 'timeline.jsonl'), 'utf8')).trim().split('\n');
    expect(l1).toHaveLength(1);
    expect(JSON.parse(l1[0]!)).toMatchObject({ seq: null });

    const dir2 = await mkdtemp(join(tmpdir(), 'rec-'));
    let clock = at(400).getTime();
    // An old Finished line makes the 2 h window already over, so the run ends after the first good poll.
    await writeFile(join(dir2, 'timeline.jsonl'), JSON.stringify({ seq: 1, fetchedAt: at(200).toISOString(), status: 'Finished', lineupPresent: true, ballsCount: 1 }) + '\n');
    const sleeps2: number[] = [];
    const logs: string[] = [];
    const client2 = mkClient(
      [
        new SportmonksError('Sportmonks /fixtures/:id responded with HTTP 503', 503, '/fixtures/:id'),
        new SportmonksError('Sportmonks /fixtures/:id failed: network error', 0, '/fixtures/:id'),
        snapshot('Finished', { lineup: 22 }),
      ],
      () => clock,
    );
    await recordFixture(client2, '777', dir2, {
      now: () => new Date(clock),
      sleep: async (ms) => {
        sleeps2.push(ms);
        clock += ms;
      },
      log: (l) => logs.push(l),
    });
    expect(sleeps2).toEqual([30_000, 30_000]);
    expect(logs.filter((l) => l.startsWith('#- error:'))).toHaveLength(2);
    expect(logs[0]).toContain('503');
    expect(logs[0]).toContain('retrying in 30s');
  });
});
