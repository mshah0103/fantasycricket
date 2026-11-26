import { join, resolve } from 'node:path';
import { createFileArchive } from '../archive.js';
import { findRepoRoot } from '../config.js';
import { buildHistory } from '../history.js';
import { flag } from './args.js';

// Reads local files only: deliberately does not use loadConfig(), so no Sportmonks token is needed.
const argv = process.argv.slice(2);
const dataDir = resolve(findRepoRoot(), process.env.FC_DATA_DIR || 'data');
const archive = createFileArchive(dataDir);
const fromYear = flag(argv, 'from') ? Number(flag(argv, 'from')) : 2008;
const toArg = flag(argv, 'to');

// Default upper bound: the latest year that has archived data (first pass without a range).
const probe = toArg ? undefined : await buildHistory(archive, join(dataDir, 'history'));
const toYear = toArg ? Number(toArg) : Math.max(...probe!.map((c) => c.year));
const coverage = await buildHistory(archive, join(dataDir, 'history'), { fromYear, toYear });

const cols = ['year', 'seasonId', 'listed', 'fetched', 'batting', 'ballByBall', 'superOver'] as const;
console.log(cols.join('\t'));
for (const c of coverage) {
  console.log([c.year, c.seasonId || '-', c.fixturesListed, c.fixturesFetched, c.withBatting, c.withBallByBall, c.superOverFixtures].join('\t'));
  if (Object.keys(c.flagsByCode).length) console.log(`  flags: ${JSON.stringify(c.flagsByCode)}`);
}
console.log(`wrote ${join(dataDir, 'history')}`);
