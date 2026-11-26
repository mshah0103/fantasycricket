import { createFileArchive } from '../archive.js';
import { createClient } from '../client.js';
import { loadConfig } from '../config.js';
import { findIplLeagueId, listIplSeasons, listSeasonFixtures, type FixtureListing } from '../discover.js';
import { pullSquads, resolveSquadTeamIds } from '../pull.js';
import { flag, requireYear } from './args.js';

// Usage: sm:pull-squads --year <year> [--teams <id,id,...>]
// Team ids come from the season's fixtures. A season with no fixtures yet (IPL 2027 after the auction) uses the
// teams of the most recent IPL season that has fixtures; --teams overrides both.
const argv = process.argv.slice(2);
const year = requireYear(argv, 'year');
const teamsArg = flag(argv, 'teams');
if (argv.includes('--teams') && (!teamsArg || !/^\d+(,\d+)*$/.test(teamsArg))) throw new Error('--teams <id,id,...> needs numeric team ids, e.g. --teams 2,5,6');
const override = teamsArg ? teamsArg.split(',') : undefined;
const { token, dataDir } = loadConfig();
const client = createClient({ token, archive: createFileArchive(dataDir) });

const leagueId = await findIplLeagueId(client);
const seasons = await listIplSeasons(client, leagueId);
const season = seasons.find((s) => s.year === year);
if (!season) throw new Error(`No IPL season found for ${year}`);

const fetched: { year: number; seasonId: string; fixtures: FixtureListing[] }[] = [];
if (!override) {
  // The requested season first, then the others newest first, until one has fixtures.
  for (const s of [season, ...seasons.filter((x) => x !== season).sort((a, b) => b.year - a.year)]) {
    const fixtures = await listSeasonFixtures(client, s.seasonId);
    fetched.push({ ...s, fixtures });
    if (fixtures.some((f) => f.localTeamId || f.visitorTeamId)) break;
  }
}
const { teamIds, source } = resolveSquadTeamIds({ year, override, seasons: fetched });
if (source.kind === 'fallback') {
  console.log(`IPL ${year} (season ${season.seasonId}) has no fixtures yet; using the team ids of IPL ${source.year} (season ${source.seasonId}): ${teamIds.join(', ')}`);
} else if (source.kind === 'override') {
  console.log(`using team ids from --teams: ${teamIds.join(', ')}`);
}
await pullSquads(client, season.seasonId, teamIds);
console.log(`pulled squads for ${teamIds.length} teams, season ${season.seasonId} (${year})`);
