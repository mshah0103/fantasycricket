import { join, resolve } from 'node:path';
import { createFileArchive, findRepoRoot } from '@fc/sportmonks';
import { importCricsheet } from '../import.js';

// Usage: cs:import --years 2008,2009,2010,2011,2012
// Reads local files only (data/cricsheet/ipl_json, data/history, the Sportmonks raw archive under data/):
// no network, and no Sportmonks token is needed. Overwrites ipl-<year>.jsonl for the given years only, and
// refuses any year that has Sportmonks fixtures in data/history/coverage.json.
const argv = process.argv.slice(2);
const i = argv.indexOf('--years');
const value = i >= 0 ? argv[i + 1] : undefined;
if (!value || !/^\d{4}(,\d{4})*$/.test(value)) throw new Error('--years <year,year,...> is required, e.g. --years 2008,2009,2010,2011,2012');
const years = value.split(',').map(Number);

const dataDir = resolve(findRepoRoot(), process.env.FC_DATA_DIR || 'data');
const historyDir = join(dataDir, 'history');
let failed = 0;
const result = await importCricsheet({
  cricsheetDir: join(dataDir, 'cricsheet', 'ipl_json'),
  historyDir,
  archive: createFileArchive(dataDir),
  years,
  onMatchError: (id, err) => {
    failed++;
    console.error(`match ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
  },
});

const ids = result.identities;
console.log(
  `identities: ${ids.identities.size} Cricsheet players known in Sportmonks from ${ids.twins} matches both sources cover; ` +
    `${ids.ambiguous.length} ambiguous; ${ids.unpaired.length} matches without a clear twin`,
);
for (const u of ids.unpaired) console.log(`  no clear twin: ${u}`);
console.log(['year', 'matches', 'ballByBall', 'superOver', 'players', 'linked', 'unresolved'].join('\t'));
for (const s of result.summary) {
  const c = result.coverage.find((x) => x.year === s.year)!;
  console.log([s.year, s.matches, c.withBallByBall, c.superOverFixtures, s.players, s.linked, s.unresolved].join('\t'));
  if (Object.keys(c.flagsByCode).length) console.log(`  flags: ${JSON.stringify(c.flagsByCode)}`);
}
console.log(`failed matches: ${failed}`);
console.log(`wrote ${historyDir} (ipl-<year>.jsonl, coverage-cricsheet.json, cricsheet-unresolved.json)`);
