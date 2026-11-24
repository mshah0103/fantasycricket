import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { endpointSlug } from './endpoints.js';

export interface ArchiveEntry {
  endpoint: string;
  params: Record<string, string>;
  fetchedAt: string;
  status: number;
  /** Path of the gzip body, relative to the archive root. */
  file: string;
}

export interface RawArchive {
  save(
    endpoint: string,
    params: Record<string, string>,
    status: number,
    body: unknown,
    fetchedAt: Date,
  ): Promise<ArchiveEntry>;
  readBody(entry: ArchiveEntry): Promise<unknown>;
  entries(): AsyncIterable<ArchiveEntry>;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function createFileArchive(rootDir: string): RawArchive {
  const base = join(rootDir, 'sportmonks');
  const manifest = join(base, 'manifest.jsonl');
  let seq = 0;
  // Serialises saves so manifest lines stay in call order.
  let chain: Promise<unknown> = Promise.resolve();

  async function doSave(
    endpoint: string,
    params: Record<string, string>,
    status: number,
    body: unknown,
    fetchedAt: Date,
  ): Promise<ArchiveEntry> {
    const dir = join(
      'sportmonks',
      String(fetchedAt.getUTCFullYear()),
      pad(fetchedAt.getUTCMonth() + 1),
      pad(fetchedAt.getUTCDate()),
      endpointSlug(endpoint),
    );
    const data = gzipSync(Buffer.from(JSON.stringify(body ?? null)));
    let file = '';
    for (;;) {
      file = join(dir, `${fetchedAt.getTime()}-${seq++}.json.gz`);
      await mkdir(join(rootDir, dir), { recursive: true });
      try {
        await writeFile(join(rootDir, file), data, { flag: 'wx' });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    const entry: ArchiveEntry = { endpoint, params, fetchedAt: fetchedAt.toISOString(), status, file };
    await mkdir(dirname(manifest), { recursive: true });
    await appendFile(manifest, JSON.stringify(entry) + '\n');
    return entry;
  }

  return {
    save(endpoint, params, status, body, fetchedAt) {
      const run = chain.then(() => doSave(endpoint, params, status, body, fetchedAt));
      chain = run.catch(() => undefined);
      return run;
    },
    async readBody(entry) {
      return JSON.parse(gunzipSync(await readFile(join(rootDir, entry.file))).toString('utf8'));
    },
    async *entries() {
      let text: string;
      try {
        text = await readFile(manifest, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
      }
      for (const line of text.split('\n')) {
        if (line.trim()) yield JSON.parse(line) as ArchiveEntry;
      }
    },
  };
}
