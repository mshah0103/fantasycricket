import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { pullHistory } from '../pull.js';
import { requireYear } from './args.js';

const argv = process.argv.slice(2);
const fromYear = requireYear(argv, 'from');
const toYear = requireYear(argv, 'to');
const { token, dataDir } = loadConfig();
const archive = createFileArchive(dataDir);
const client = createClient({ token, archive });

const r = await pullHistory(client, archive, { fromYear, toYear, log: (l) => console.log(l) });
console.log(`done: fetched=${r.fetched} skipped=${r.skipped} failed=${r.failed.length}`);
if (r.failed.length) console.log(`failed fixture ids: ${r.failed.join(', ')}`);
