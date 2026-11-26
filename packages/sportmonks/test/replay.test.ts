import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildScoreCatalog } from '../src/fieldMap.js';
import { readRecording } from '../src/record.js';
import { replayScores } from '../src/replay.js';

type Obj = Record<string, any>;
const load = (name: string): Obj => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

describe('replayScores', () => {
  it('re-scores a synthetic recording snapshot by snapshot', async () => {
    const catalog = buildScoreCatalog(load('scores.json'));
    const full = load('ipl2025-m64-gt-lsg.json');
    const all = full.data.balls as unknown[];
    const dir = await mkdtemp(join(tmpdir(), 'replay-'));
    const lines: string[] = [];
    const counts = [40, 80, all.length];
    for (const [i, n] of counts.entries()) {
      const body = structuredClone(full);
      body.data.balls = all.slice(0, n);
      const seq = i + 1;
      const fetchedAt = new Date(Date.UTC(2025, 4, 22, 14, seq)).toISOString();
      await writeFile(join(dir, `${seq}.json.gz`), gzipSync(Buffer.from(JSON.stringify(body))));
      lines.push(JSON.stringify({ seq, fetchedAt, status: 'Finished', lineupPresent: true, ballsCount: n }));
    }
    lines.splice(1, 0, JSON.stringify({ seq: null, fetchedAt: '2025-05-22T14:01:30.000Z', error: 'boom' }));
    await writeFile(join(dir, 'timeline.jsonl'), lines.join('\n') + '\n');

    const ballCounts: number[] = [];
    const seqs: number[] = [];
    for await (const s of readRecording(dir)) {
      seqs.push(s.seq);
      ballCounts.push(((s.body as Obj).data.balls as unknown[]).length);
    }
    expect(seqs).toEqual([1, 2, 3]);
    expect(ballCounts).toEqual([40, 80, all.length]);
    expect(ballCounts).toEqual([...ballCounts].sort((a, b) => a - b));

    const results = [];
    for await (const r of replayScores(dir, catalog)) results.push(r);
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(results[0]!.fetchedAt).toBe('2025-05-22T14:01:00.000Z');
    expect(results[2]!.scores.get('31')!.totalHalfPoints).toBe(185);
  });

  it('pre-match snapshot shapes do not throw and later snapshots score normally', async () => {
    const catalog = buildScoreCatalog(load('scores.json'));
    const full = load('ipl2025-m64-gt-lsg.json');
    const keys = ['lineup', 'batting', 'bowling', 'balls', 'runs', 'scoreboards'];
    const base = (): Obj => ({ data: { ...structuredClone(full.data), status: 'NS' } });
    const emptied = base();
    for (const k of keys) emptied.data[k] = [];
    const absent = base();
    for (const k of keys) delete absent.data[k];
    const lineupOnly = base();
    for (const k of ['batting', 'bowling', 'balls', 'runs', 'scoreboards']) delete lineupOnly.data[k];
    const bodies = [emptied, absent, lineupOnly, full];

    const dir = await mkdtemp(join(tmpdir(), 'replay-'));
    const lines: string[] = [];
    for (const [i, body] of bodies.entries()) {
      const seq = i + 1;
      await writeFile(join(dir, `${seq}.json.gz`), gzipSync(Buffer.from(JSON.stringify(body))));
      lines.push(JSON.stringify({ seq, fetchedAt: new Date(Date.UTC(2025, 4, 22, 13, seq)).toISOString(), status: 'NS' }));
    }
    await writeFile(join(dir, 'timeline.jsonl'), lines.join('\n') + '\n');

    const results = [];
    for await (const r of replayScores(dir, catalog)) results.push(r);
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(results[0]!.scores.size).toBe(0);
    expect(results[1]!.scores.size).toBe(0);
    // Lineup only: every player has a record and scores exactly 0 (spec §5.7: no appearance points).
    expect(results[2]!.scores.size).toBeGreaterThan(0);
    for (const s of results[2]!.scores.values()) expect(s.totalHalfPoints).toBe(0);
    expect(results[3]!.scores.get('31')!.totalHalfPoints).toBe(185);
  });
});
