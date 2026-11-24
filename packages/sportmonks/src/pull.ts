import type { ArchiveEntry, RawArchive } from './archive.js';
import { SportmonksError, type SportmonksClient } from './client.js';
import { findIplLeagueId, listIplSeasons, listSeasonFixtures } from './discover.js';
import { FIXTURE_INCLUDES, paths } from './endpoints.js';

const is2xx = (e: ArchiveEntry) => e.status >= 200 && e.status < 300;

/** Latest 2xx archive entry whose concrete endpoint equals `endpoint`, or undefined. */
export async function latestEntryForPath(archive: RawArchive, endpoint: string): Promise<ArchiveEntry | undefined> {
  let best: ArchiveEntry | undefined;
  for await (const e of archive.entries()) {
    if (e.endpoint === endpoint && is2xx(e) && (!best || e.fetchedAt >= best.fetchedAt)) best = e;
  }
  return best;
}

export async function pullHistory(
  client: SportmonksClient,
  archive: RawArchive,
  opts: { fromYear: number; toYear: number; log?: (line: string) => void },
): Promise<{ fetched: number; skipped: number; failed: string[] }> {
  const log = opts.log ?? (() => {});
  await client.get(paths.scores);

  const done = new Set<string>();
  for await (const e of archive.entries()) {
    const m = /^\/fixtures\/(\d+)$/.exec(e.endpoint);
    if (m && is2xx(e)) done.add(m[1]!);
  }

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

export async function pullSquads(client: SportmonksClient, seasonId: string, teamIds: string[]): Promise<void> {
  for (const teamId of teamIds) await client.get(paths.teamSquad(teamId, seasonId));
}
