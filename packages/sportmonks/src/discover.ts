import type { SportmonksClient } from './client.js';
import { FIXTURE_INCLUDES, paths } from './endpoints.js';

export { FIXTURE_INCLUDES };

export interface FixtureListing {
  fixtureId: string;
  seasonId: string;
  startingAt: string;
  localTeamId: string;
  visitorTeamId: string;
  round: string | null;
  status: string;
  superOver: boolean;
}

// --- Sportmonks v2 response-shape assumptions live in this block only. ---
type Obj = Record<string, unknown>;

/** Unwraps `{ data: X }` -> X; anything else is returned unchanged. */
function unwrap(x: unknown): unknown {
  return x && typeof x === 'object' && !Array.isArray(x) && 'data' in (x as Obj) ? (x as Obj).data : x;
}

/** Items of a response body or include: accepts `[...]` or `{ data: [...] }`, at most one level of `{data}` wrapping on the body. */
function asList(x: unknown): Obj[] {
  const v = unwrap(x);
  return Array.isArray(v) ? (v as Obj[]) : [];
}

const str = (x: unknown): string => (x === null || x === undefined ? '' : String(x));
// ---------------------------------------------------------------------------

export async function findLeagueId(client: SportmonksClient, name: string): Promise<string> {
  const { body } = await client.get(paths.leagues);
  const league = asList(body).find((l) => l.name === name);
  if (!league) throw new Error(`League "${name}" not found in GET /leagues response`);
  return str(league.id);
}

export async function findIplLeagueId(client: SportmonksClient): Promise<string> {
  return findLeagueId(client, 'Indian Premier League');
}

export async function listIplSeasons(
  client: SportmonksClient,
  leagueId: string,
): Promise<{ seasonId: string; year: number }[]> {
  const { body } = await client.get(paths.seasons, { 'filter[league_id]': leagueId });
  const out: { seasonId: string; year: number }[] = [];
  for (const s of asList(body)) {
    if (str(s.league_id) !== leagueId) continue;
    const m = /\d{4}/.exec(str(s.name));
    if (!m) continue;
    out.push({ seasonId: str(s.id), year: Number(m[0]) });
  }
  return out.sort((a, b) => a.year - b.year);
}

export async function listSeasonFixtures(client: SportmonksClient, seasonId: string): Promise<FixtureListing[]> {
  const { body } = await client.get(paths.season(seasonId), { include: 'fixtures' });
  const season = unwrap(body) as Obj | null;
  return asList(season?.fixtures).map((f) => ({
    fixtureId: str(f.id),
    seasonId: str(f.season_id),
    startingAt: str(f.starting_at),
    localTeamId: str(f.localteam_id),
    visitorTeamId: str(f.visitorteam_id),
    round: f.round === null || f.round === undefined ? null : str(f.round),
    status: str(f.status),
    superOver: f.super_over === true,
  }));
}
