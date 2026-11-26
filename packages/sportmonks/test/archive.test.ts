import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createFileArchive, type ArchiveEntry } from '../src/archive.js';

describe('file archive', () => {
  it('round-trips a body, writes gzip, and lists entries in order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arch-'));
    const archive = createFileArchive(root);
    const at = new Date('2026-04-01T10:00:00.000Z');
    const e1 = await archive.save('/fixtures/123', { include: 'batting' }, 200, { a: 1 }, at);
    const e2 = await archive.save('/fixtures/456', {}, 404, { b: 2 }, at);

    expect(await archive.readBody(e1)).toEqual({ a: 1 });
    expect(e1.file).toContain('sportmonks/2026/04/01/fixtures-id/');
    expect(e1.fetchedAt).toBe('2026-04-01T10:00:00.000Z');
    expect(e1.endpoint).toBe('/fixtures/123');
    expect(e2.endpoint).toBe('/fixtures/456');
    expect(e2.status).toBe(404);
    expect(e1.file).not.toBe(e2.file);

    const raw = await readFile(join(root, e1.file));
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
    expect(JSON.parse(gunzipSync(raw).toString())).toEqual({ a: 1 });

    const seen: ArchiveEntry[] = [];
    for await (const e of archive.entries()) seen.push(e);
    expect(seen).toEqual([e1, e2]);
  });

  it('yields nothing when no manifest exists', async () => {
    const archive = createFileArchive(await mkdtemp(join(tmpdir(), 'arch-')));
    const seen: ArchiveEntry[] = [];
    for await (const e of archive.entries()) seen.push(e);
    expect(seen).toEqual([]);
  });
});
