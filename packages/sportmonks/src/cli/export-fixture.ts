import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileArchive } from '../archive.js';
import { findRepoRoot, loadConfig } from '../config.js';
import { paths } from '../endpoints.js';
import { latestEntryForPath } from '../pull.js';

const [fixtureId, name] = process.argv.slice(2);
if (!fixtureId || !name || !/^\d+$/.test(fixtureId) || !/^[\w.-]+$/.test(name)) {
  throw new Error('usage: sm:export-fixture <fixtureId> <name>');
}
const archive = createFileArchive(loadConfig().dataDir);
const entry = await latestEntryForPath(archive, paths.fixture(fixtureId));
if (!entry) throw new Error(`No successful archived response for ${paths.fixture(fixtureId)}; run sm:pull-history first`);
const body = await archive.readBody(entry);
const dir = join(findRepoRoot(), 'packages/sportmonks/test/fixtures');
await mkdir(dir, { recursive: true });
const out = join(dir, `${name}.json`);
await writeFile(out, JSON.stringify(body, null, 2) + '\n');
console.log(`wrote ${out}`);
