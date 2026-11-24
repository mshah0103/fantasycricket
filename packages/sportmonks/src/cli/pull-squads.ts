import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { findIplLeagueId, listIplSeasons, listSeasonFixtures } from '../discover.js';
import { pullSquads } from '../pull.js';
import { requireYear } from './args.js';

const year = requireYear(process.argv.slice(2), 'year');
const { token, dataDir } = loadConfig();
const client = createClient({ token, archive: createFileArchive(dataDir) });

const leagueId = await findIplLeagueId(client);
const season = (await listIplSeasons(client, leagueId)).find((s) => s.year === year);
if (!season) throw new Error(`No IPL season found for ${year}`);
const fixtures = await listSeasonFixtures(client, season.seasonId);
const teamIds = [...new Set(fixtures.flatMap((f) => [f.localTeamId, f.visitorTeamId]).filter(Boolean))];
await pullSquads(client, season.seasonId, teamIds);
console.log(`pulled squads for ${teamIds.length} teams, season ${season.seasonId} (${year})`);
