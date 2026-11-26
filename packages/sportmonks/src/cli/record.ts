import { join } from 'node:path';
import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { recordFixture } from '../record.js';
import { flag } from './args.js';

// Usage: sm:record --fixture <id> [--dir <path>]   (default dir: <dataDir>/recordings/<fixtureId>)
// Start it more than 60 min before the match; it stops 2 h after the fixture finishes.
const argv = process.argv.slice(2);
const fixtureId = flag(argv, 'fixture');
if (!fixtureId || !/^\d+$/.test(fixtureId)) throw new Error('--fixture <id> is required (numeric fixture id)');
const { token, dataDir } = loadConfig();
const dir = flag(argv, 'dir') ?? join(dataDir, 'recordings', fixtureId);
const client = createClient({ token, archive: createFileArchive(dataDir) });

console.log(`recording fixture ${fixtureId} into ${dir}`);
await recordFixture(client, fixtureId, dir, {
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});
console.log('done');
