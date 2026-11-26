import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileArchive, type RawArchive } from '../src/archive.js';
import { GATES_END_MARKER, buildGateReport, mergeGateReport } from '../src/gates.js';
import { buildHistory } from '../src/history.js';

type Obj = Record<string, any>;
const load = (name: string): Obj => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Obj;

let tmp: string;
let historyDir: string;
let recordingsDir: string;
let archive: RawArchive;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gates-'));
  historyDir = join(tmp, 'history');
  recordingsDir = join(tmp, 'recordings');
  archive = createFileArchive(tmp);
  const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
  await archive.save('/scores', {}, 200, load('scores.json'), t(0));
  await archive.save('/fixtures/65607', {}, 200, load('ipl2025-m64-gt-lsg.json'), t(1));
  await archive.save('/fixtures/65574', {}, 200, load('ipl2025-m32-dc-rr-superover.json'), t(2));
  await archive.save('/fixtures/65586', {}, 200, load('ipl2025-m44-kkr-pbks-noresult.json'), t(3));
  await buildHistory(archive, historyDir);
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

async function writeRecording(): Promise<void> {
  const dir = join(recordingsDir, '65607');
  await mkdir(dir, { recursive: true });
  const full = load('ipl2025-m64-gt-lsg.json');
  const lines: string[] = [];
  const startMs = Date.parse(full.data.starting_at as string);
  const snaps = [
    { n: 1, at: startMs - 30 * 60_000, status: 'NS', balls: 0 },
    { n: 2, at: startMs + 4 * 3600_000, status: 'Finished', balls: full.data.balls.length },
  ];
  for (const s of snaps) {
    const body = structuredClone(full);
    body.data.status = s.status;
    body.data.balls = full.data.balls.slice(0, s.balls);
    await writeFile(join(dir, `${s.n}.json.gz`), gzipSync(Buffer.from(JSON.stringify(body))));
    lines.push(JSON.stringify({ seq: s.n, fetchedAt: new Date(s.at).toISOString(), status: s.status, lineupPresent: true, ballsCount: s.balls }));
  }
  await writeFile(join(dir, 'timeline.jsonl'), lines.join('\n') + '\n');
}

describe('buildGateReport', () => {
  it('has a section per gate and lists the Super Over fixture under Gate 3', async () => {
    await writeRecording();
    const md = await buildGateReport({ historyDir, recordingsDir, archive });
    for (let g = 1; g <= 8; g++) expect(md).toMatch(new RegExp(`^## Gate ${g}\\b`, 'm'));
    const gate3 = md.split(/^## Gate 3\b/m)[1]!.split(/^## Gate 4\b/m)[0]!;
    expect(gate3).toContain('65574');
    expect(gate3).toContain('S3');
    expect(gate3).toContain('none detected');
    expect(gate3).toContain('15267');
    expect(gate3).toMatch(/not that the data is complete/);
    expect(md.trimEnd().endsWith(GATES_END_MARKER)).toBe(true);
    const gate5 = md.split(/^## Gate 5\b/m)[1]!.split(/^## Gate 6\b/m)[0]!;
    expect(gate5).toContain('65607');
    expect(gate5).toContain('-30');
    expect(md.split(/^## Gate 7\b/m)[1]!.split(/^## Gate 8\b/m)[0]).toContain('65607');
  });

  it('is deterministic', async () => {
    await writeRecording();
    const a = await buildGateReport({ historyDir, recordingsDir, archive });
    const b = await buildGateReport({ historyDir, recordingsDir, archive });
    expect(a).toBe(b);
  });

  it('renders Gates 5, 7 and 8 as Pending with no recordings and no squads', async () => {
    const md = await buildGateReport({ historyDir, recordingsDir, archive });
    for (const g of [5, 7, 8]) {
      const next = g + 1;
      const section = md.split(new RegExp(`^## Gate ${g}\\b`, 'm'))[1]!.split(new RegExp(`^## Gate ${next}\\b|${GATES_END_MARKER}`, 'm'))[0]!;
      expect(section).toContain('Pending');
    }
  });
});

describe('Gate 8 squads', () => {
  it('counts positions, lists players without one and shows the distribution', async () => {
    const t = new Date(Date.UTC(2026, 11, 20));
    await archive.save('/leagues', {}, 200, { data: [{ id: 1, name: 'Indian Premier League' }] }, t);
    await archive.save('/seasons', { 'filter[league_id]': '1' }, 200, { data: [{ id: 1795, league_id: 1, name: '2026' }, { id: 2001, league_id: 1, name: '2027' }] }, t);
    const player = (id: number, fullname: string, position: unknown) => ({ resource: 'players', id, fullname, firstname: 'x', lastname: 'y', position, squad: { season_id: 2001 } });
    await archive.save('/teams/8/squad/2001', {}, 200, {
      data: {
        resource: 'teams', id: 8, name: 'Team', code: 'T',
        squad: [player(11, 'Has Position', { resource: 'positions', id: 3, name: 'Wicketkeeper' }), player(12, 'No Position', null)],
      },
    }, t);
    const md = await buildGateReport({ historyDir, recordingsDir, archive });
    const g8 = md.split(/^## Gate 8\b/m)[1]!;
    expect(g8).toContain('season 2001');
    expect(g8).toContain('2 players. With a position: 1. Without: 1.');
    expect(g8).toContain('| 12 | No Position | 8 |');
    expect(g8).not.toContain('Has Position');
    expect(g8).toContain('| 3 Wicketkeeper | 1 |');
    expect(g8).not.toContain('Pending');
  });
});

describe('mergeGateReport', () => {
  const gen = `# T\n\n## Gate 1\nnew\n\n${GATES_END_MARKER}\n`;
  it('keeps everything after the marker', () => {
    const existing = `# T\n\n## Gate 1\nold\n\n${GATES_END_MARKER}\n\n## Manual checks\nhand written\n\n## Spec impact\nnone\n`;
    const out = mergeGateReport(existing, gen);
    expect(out).toContain('new');
    expect(out).not.toContain('old');
    expect(out.endsWith('\n\n## Manual checks\nhand written\n\n## Spec impact\nnone\n')).toBe(true);
  });
  it('creates empty manual sections when there is no file', () => {
    const out = mergeGateReport(null, gen);
    expect(out).toBe(`${gen}\n## Manual checks\n\n## Spec impact\n`);
  });
  it('treats an existing file without the marker as new and does not lose it silently', () => {
    expect(() => mergeGateReport('hand written only', gen)).toThrow(/END GENERATED/);
  });
});
