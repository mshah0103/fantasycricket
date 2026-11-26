import { join } from 'node:path';
import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { recordFixture } from '../record.js';
import { flag, userPath } from './args.js';

// Usage: sm:record --fixture <id> [--dir <path>]   (default dir: <dataDir>/recordings/<fixtureId>)
// A relative --dir is relative to where the command was typed (INIT_CWD). Start it more than 60 min before the
// match; it stops 2 h after the fixture finishes, or 12 h after the start if the fixture never finishes.
const argv = process.argv.slice(2);
const fixtureId = flag(argv, 'fixture');
if (!fixtureId || !/^\d+$/.test(fixtureId)) throw new Error('--fixture <id> is required (numeric fixture id)');
const { token, dataDir } = loadConfig();
const dirFlag = flag(argv, 'dir');
const dir = dirFlag ? userPath(dirFlag) : join(dataDir, 'recordings', fixtureId);
const client = createClient({ token, archive: createFileArchive(dataDir), timeoutMs: 10_000 });

console.log(`recording fixture ${fixtureId} into ${dir}`);
try {
  await recordFixture(client, fixtureId, dir, {
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  console.log('done');
} catch (e) {
  console.error(e instanceof Error ? e.message : 'recording failed');
  process.exit(1);
}
