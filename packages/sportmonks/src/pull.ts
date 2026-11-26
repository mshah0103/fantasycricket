import type { ArchiveEntry, RawArchive } from './archive.js';
import { SportmonksError, type SportmonksClient } from './client.js';
import { findIplLeagueId, listIplSeasons, listSeasonFixtures, type FixtureListing } from './discover.js';
import { FIXTURE_INCLUDES, paths } from './endpoints.js';
import { statusGroup } from './fieldMap.js';

const is2xx = (e: ArchiveEntry) => e.status >= 200 && e.status < 300;

/** Latest 2xx archive entry whose concrete endpoint equals `endpoint`, or undefined. */
export async function latestEntryForPath(archive: RawArchive, endpoint: string): Promise<ArchiveEntry | undefined> {
  let best: ArchiveEntry | undefined;
  for await (const e of archive.entries()) {
    if (e.endpoint === endpoint && is2xx(e) && (!best || e.fetchedAt >= best.fetchedAt)) best = e;
  }
  return best;
}

/** Status of an archived fixture body `{ data: { status } }`; '' when absent. */
function fixtureStatus(body: unknown): string {
  const d = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  const status = d && typeof d === 'object' ? (d as { status?: unknown }).status : undefined;
  return typeof status === 'string' ? status : '';
}

/**
 * Pulls `/scores` and every IPL fixture of the seasons in range. Resumable: a fixture is skipped only when its
 * latest archived 2xx body has a finished-group status (`statusGroup`); one archived before or during the match
 * is fetched again.
 */
export async function pullHistory(
  client: SportmonksClient,
  archive: RawArchive,
  opts: { fromYear: number; toYear: number; log?: (line: string) => void },
): Promise<{ fetched: number; skipped: number; failed: string[] }> {
  const log = opts.log ?? (() => {});
  await client.get(paths.scores);

  const latest = new Map<string, ArchiveEntry>();
  for await (const e of archive.entries()) {
    const m = /^\/fixtures\/(\d+)$/.exec(e.endpoint);
    if (!m || !is2xx(e)) continue;
    const cur = latest.get(m[1]!);
    if (!cur || e.fetchedAt >= cur.fetchedAt) latest.set(m[1]!, e);
  }
  const done = new Set<string>();
  for (const [id, e] of latest) if (statusGroup(fixtureStatus(await archive.readBody(e))) === 'finished') done.add(id);

  const leagueId = await findIplLeagueId(client);
  const seasons = (await listIplSeasons(client, leagueId)).filter(
    (s) => s.year >= opts.fromYear && s.year <= opts.toYear,
  );

  let fetched = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const season of seasons) {
    const fixtures = await listSeasonFixtures(client, season.seasonId);
    for (const f of fixtures) {
      if (done.has(f.fixtureId)) {
        skipped++;
        log(`skipped ${f.fixtureId} (${season.year})`);
        continue;
      }
      try {
        await client.get(paths.fixture(f.fixtureId), { include: FIXTURE_INCLUDES.join(',') });
        fetched++;
        log(`fetched ${f.fixtureId} (${season.year})`);
      } catch (e) {
        if (!(e instanceof SportmonksError)) throw e;
        failed.push(f.fixtureId);
        log(`failed ${f.fixtureId} (${season.year}): HTTP ${e.status}`);
      }
    }
  }
  return { fetched, skipped, failed };
}

export interface SquadTeams {
  /** Distinct team ids, sorted numerically. */
  teamIds: string[];
  /** Where they came from: `--teams`, the requested season's fixtures, or an earlier season's (fallback). */
  source: { kind: 'override' } | { kind: 'season'; year: number; seasonId: string } | { kind: 'fallback'; year: number; seasonId: string };
}

const teamIdsOf = (fixtures: readonly FixtureListing[]): string[] =>
  [...new Set(fixtures.flatMap((f) => [f.localTeamId, f.visitorTeamId]).filter(Boolean))].sort((a, b) => Number(a) - Number(b));

/**
 * Team ids to pull squads for (pure; `sm:pull-squads`). `override` (`--teams`) wins. Otherwise the teams of the
 * requested season's fixtures. When that season has none yet (e.g. IPL 2027 right after the auction), the teams of
 * the most recent other season that has fixtures: IPL franchises are stable. `seasons` holds the fixture listings
 * fetched so far, in any order. Throws when no team id is found.
 */
export function resolveSquadTeamIds(input: {
  year: number;
  override?: readonly string[];
  seasons: readonly { year: number; seasonId: string; fixtures: readonly FixtureListing[] }[];
}): SquadTeams {
  if (input.override && input.override.length > 0) {
    return { teamIds: [...new Set(input.override)].sort((a, b) => Number(a) - Number(b)), source: { kind: 'override' } };
  }
  const requested = input.seasons.find((s) => s.year === input.year);
  if (requested && teamIdsOf(requested.fixtures).length > 0) {
    return { teamIds: teamIdsOf(requested.fixtures), source: { kind: 'season', year: requested.year, seasonId: requested.seasonId } };
  }
  const fallback = input.seasons
    .filter((s) => s.year !== input.year && teamIdsOf(s.fixtures).length > 0)
    .sort((a, b) => b.year - a.year)[0];
  if (fallback) return { teamIds: teamIdsOf(fallback.fixtures), source: { kind: 'fallback', year: fallback.year, seasonId: fallback.seasonId } };
  throw new Error(
    `No team ids found for IPL ${input.year}: neither that season nor any other IPL season has fixtures with teams. Pass --teams <id,id,...>.`,
  );
}

export async function pullSquads(client: SportmonksClient, seasonId: string, teamIds: string[]): Promise<void> {
  for (const teamId of teamIds) await client.get(paths.teamSquad(teamId, seasonId));
}
