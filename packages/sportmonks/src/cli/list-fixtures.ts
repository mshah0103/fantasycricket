import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { findLeagueId, listIplSeasons, listSeasonFixtures } from '../discover.js';
import { flag, requireYear } from './args.js';

// Usage: sm:list-fixtures --season <year> [--league "<name>"]   (default league: Indian Premier League)
// Seasons are matched by the first 4-digit year in the season name, so a Big Bash season named
// "2026/2027" is --season 2026.
const argv = process.argv.slice(2);
const year = requireYear(argv, 'season');
const leagueName = flag(argv, 'league') ?? 'Indian Premier League';
const { token, dataDir } = loadConfig();
const client = createClient({ token, archive: createFileArchive(dataDir) });

const leagueId = await findLeagueId(client, leagueName);
const season = (await listIplSeasons(client, leagueId)).find((s) => s.year === year);
if (!season) throw new Error(`No ${leagueName} season found for ${year}`);
const fixtures = await listSeasonFixtures(client, season.seasonId);
console.log(['fixtureId', 'startingAt', 'localTeamId', 'visitorTeamId', 'round', 'status', 'superOver'].join('\t'));
for (const f of fixtures) {
  console.log([f.fixtureId, f.startingAt, f.localTeamId, f.visitorTeamId, f.round ?? '', f.status, f.superOver].join('\t'));
}
console.log(`${fixtures.length} fixtures (season ${season.seasonId})`);
