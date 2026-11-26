import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scorePlayerMatch } from '@fc/scoring';
import type { ArchiveEntry, RawArchive, ScoredPlayerMatch, SeasonCoverage } from '@fc/sportmonks';
import { applyLinks, comparePlayerIds, linkPlayers, sportmonksLineupPlayers, type SportmonksPlayerRef } from './link.js';
import { cricsheetMatchYear, normalizeCricsheetMatch, type CricsheetFixture } from './normalize.js';

/** One row of `cricsheet-unresolved.json`: a Cricsheet player left on his `cs:` id, per year and team. */
export interface UnresolvedPlayer {
  year: number;
  csId: string;
  name: string;
  team: string;
  matches: number;
}

/** Per-year summary of an import (CLI output and the report). Player counts are distinct Cricsheet ids. */
export interface ImportYearSummary {
  year: number;
  matches: number;
  players: number;
  linked: number;
  unresolved: number;
}

export interface ImportOptions {
  /** Directory of Cricsheet match files `<id>.json` (data/cricsheet/ipl_json). */
  cricsheetDir: string;
  /** data/history: must hold Sportmonks `coverage.json`; receives the outputs. */
  historyDir: string;
  /** The Sportmonks raw archive: lineups of every archived IPL fixture are the link candidates. */
  archive: RawArchive;
  years: number[];
  /** Called for a match file of an imported year that could not be read, dated or normalized. */
  onMatchError?: (matchId: string, error: unknown) => void;
}

export interface ImportResult {
  coverage: SeasonCoverage[];
  unresolved: UnresolvedPlayer[];
  summary: ImportYearSummary[];
  identities: IdentityEvidence;
}

/** One archived Sportmonks IPL fixture's lineup, with its UTC start date. */
export interface SportmonksFixtureLineup {
  id: string;
  date: string;
  players: SportmonksPlayerRef[];
}

/**
 * Who each Cricsheet player is in Sportmonks, from the matches both sources cover ("twins").
 * Cricsheet's registry id is one id per person across all seasons, so a link made in a twin carries to that
 * person's other matches, including seasons Sportmonks lacks.
 */
export interface IdentityEvidence {
  /** Cricsheet player id -> Sportmonks player id, when every twin agrees and no other Cricsheet id claims it. */
  identities: Map<string, string>;
  /** Cricsheet ids linked in twins to more than one Sportmonks id, or to one that another Cricsheet id is also linked to. */
  ambiguous: string[];
  /** Cricsheet matches paired with a Sportmonks fixture. */
  twins: number;
  /** Cricsheet matches with Sportmonks fixtures on their date but no clear twin (match id and reason). */
  unpaired: string[];
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string => (x === null || x === undefined ? '' : String(x));
const cmp = <T extends string | number>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

async function readJsonOrNull(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * The lineup of every archived Sportmonks IPL fixture (latest 2xx body per fixture), sorted by fixture id, and
 * Sportmonks team names (team id -> name, from `balls[].team`). Without an archived `/leagues` body
 * (synthetic test archives) every fixture counts as IPL, as in `buildHistory`.
 */
export async function loadSportmonksLineups(
  archive: RawArchive,
): Promise<{ fixtures: SportmonksFixtureLineup[]; teamNames: Map<string, string> }> {
  let leagues: ArchiveEntry | undefined;
  const entries = new Map<string, ArchiveEntry>();
  const newer = (a: ArchiveEntry | undefined, b: ArchiveEntry) => (!a || b.fetchedAt >= a.fetchedAt ? b : a);
  for await (const e of archive.entries()) {
    if (e.status < 200 || e.status >= 300) continue;
    if (e.endpoint === '/leagues') leagues = newer(leagues, e);
    const f = /^\/fixtures\/(\d+)$/.exec(e.endpoint);
    if (f) entries.set(f[1]!, newer(entries.get(f[1]!), e));
  }
  let iplLeagueId: string | null = null;
  if (leagues) {
    const body = await archive.readBody(leagues);
    const list = isObj(body) && Array.isArray(body.data) ? body.data.filter(isObj) : [];
    const league = list.find((l) => l.name === 'Indian Premier League');
    if (!league) throw new Error('loadSportmonksLineups: "Indian Premier League" not found in archived /leagues');
    iplLeagueId = str(league.id);
  }
  const fixtures: SportmonksFixtureLineup[] = [];
  const teamNames = new Map<string, string>();
  for (const id of [...entries.keys()].sort((a, b) => Number(a) - Number(b))) {
    const body = await archive.readBody(entries.get(id)!);
    const data = isObj(body) ? body.data : undefined;
    if (!isObj(data)) continue;
    if (iplLeagueId !== null && str(data.league_id) !== iplLeagueId) continue;
    const start = Date.parse(str(data.starting_at));
    if (Number.isNaN(start)) continue;
    const lineup = sportmonksLineupPlayers(body);
    fixtures.push({ id, date: new Date(start).toISOString().slice(0, 10), players: lineup.players });
    for (const [t, name] of lineup.teamNames) teamNames.set(t, name); // later fixtures win
  }
  return { fixtures, teamNames: new Map([...teamNames].sort(([a], [b]) => comparePlayerIds(a, b))) };
}

/** A twin must link at least this many players (half of two XIs) and more than any other fixture that day. */
const MIN_TWIN_LINKS = 11;

/**
 * Identity evidence from twins (see `IdentityEvidence`). A Cricsheet match's twin is the Sportmonks fixture on
 * the same UTC date (Cricsheet's date is the local date; IPL starts are 10:00–14:30 UTC) whose lineup links the
 * most players with `linkPlayers` (that fixture's lineup only), with at least `MIN_TWIN_LINKS` links and
 * strictly more than any other fixture that day. A player's identity is kept only when all his twin links name
 * one Sportmonks id and no other Cricsheet id is linked to it.
 */
export function identitiesFromTwins(
  matches: readonly CricsheetFixture[],
  sportmonks: { fixtures: readonly SportmonksFixtureLineup[]; teamNames: ReadonlyMap<string, string> },
): IdentityEvidence {
  const byDate = new Map<string, SportmonksFixtureLineup[]>();
  for (const f of sportmonks.fixtures) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f]);
  const seen = new Map<string, Set<string>>();
  const unpaired: string[] = [];
  let twins = 0;
  for (const m of matches) {
    const candidates = byDate.get(m.meta.startingAt.slice(0, 10)) ?? [];
    if (candidates.length === 0) continue;
    const ranked = candidates
      .map((f) => ({ f, linked: linkPlayers(m, f.players, { teamNames: sportmonks.teamNames }).linked }))
      .sort((a, b) => b.linked.size - a.linked.size || Number(a.f.id) - Number(b.f.id));
    const [best, next] = ranked;
    if (best!.linked.size < MIN_TWIN_LINKS || (next && next.linked.size === best!.linked.size)) {
      unpaired.push(`${m.meta.fixtureId}: best Sportmonks fixture ${best!.f.id} links ${best!.linked.size}${next ? `, next ${next.f.id} links ${next.linked.size}` : ''}`);
      continue;
    }
    twins++;
    for (const [csId, smId] of best!.linked) seen.set(csId, (seen.get(csId) ?? new Set()).add(smId));
  }
  const claims = new Map<string, number>();
  for (const s of seen.values()) for (const smId of s) claims.set(smId, (claims.get(smId) ?? 0) + 1);
  const identities = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [csId, s] of [...seen].sort(([a], [b]) => cmp(a, b))) {
    const [smId] = s;
    if (s.size === 1 && claims.get(smId!) === 1) identities.set(csId, smId!);
    else ambiguous.push(csId);
  }
  return { identities, ambiguous, twins, unpaired };
}

const emptyCoverage = (year: number): SeasonCoverage => ({
  year,
  seasonId: `cs:${year}`,
  fixturesListed: 0,
  fixturesFetched: 0,
  withBatting: 0,
  withBallByBall: 0,
  superOverFixtures: 0,
  flagsByCode: {},
});

const hasBatting = (n: CricsheetFixture) => n.players.some((p) => p.regulation.batting !== null || p.superOver?.batting != null);

/**
 * One-time Cricsheet import for IPL seasons Sportmonks lacks (spec §12.1, Task 12). For each year: normalizes
 * every match whose first date falls in it, puts players on their Sportmonks ids where `identitiesFromTwins`
 * (over every Cricsheet match, any year) knows them, scores them with the same engine, and overwrites
 * `ipl-<year>.jsonl` (same lines and order as `buildHistory`). Also writes `coverage-cricsheet.json` and
 * `cricsheet-unresolved.json`, keeping rows for years not imported now. Refuses, before writing anything, a
 * year that has Sportmonks fixtures in `coverage.json`. Deterministic.
 */
export async function importCricsheet(opts: ImportOptions): Promise<ImportResult> {
  const years = [...new Set(opts.years)].sort((a, b) => a - b);
  if (years.length === 0) throw new Error('importCricsheet: no years given');
  for (const y of years) if (!Number.isInteger(y) || y < 1000 || y > 9999) throw new Error(`importCricsheet: bad year ${y}`);

  const smCoveragePath = join(opts.historyDir, 'coverage.json');
  const smCoverage = (await readJsonOrNull(smCoveragePath)) as SeasonCoverage[] | null;
  if (!Array.isArray(smCoverage)) {
    throw new Error(`${smCoveragePath} not found or not a list: run sm:build-history first, so the import can check which years Sportmonks covers`);
  }
  const clash = years.filter((y) => smCoverage.some((c) => c.year === y && c.fixturesFetched > 0));
  if (clash.length > 0) {
    throw new Error(`Refusing to import ${clash.join(', ')}: Sportmonks has fixtures for ${clash.length === 1 ? 'that year' : 'those years'} in coverage.json`);
  }

  // 1. Every Cricsheet match: the imported years are output, all of them are identity evidence.
  const coverage = new Map(years.map((y) => [y, emptyCoverage(y)]));
  const imported: { year: number; matchId: number; n: CricsheetFixture }[] = [];
  const all: CricsheetFixture[] = [];
  const files = (await readdir(opts.cricsheetDir)).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const file of files) {
    const matchId = file.slice(0, -'.json'.length);
    let json: unknown = null;
    let jsonError: unknown = null;
    try {
      json = JSON.parse(await readFile(join(opts.cricsheetDir, file), 'utf8'));
    } catch (err) {
      jsonError = err;
    }
    const year = jsonError === null ? cricsheetMatchYear(json) : null;
    const c = year === null ? undefined : coverage.get(year);
    if (year === null) {
      // Its year is unknown, so it may belong to an imported year: always reported.
      opts.onMatchError?.(matchId, jsonError ?? new Error('no valid info.dates[0]; match not dated'));
      continue;
    }
    if (c) {
      c.fixturesListed++;
      c.fixturesFetched++;
    }
    let n: CricsheetFixture;
    try {
      n = normalizeCricsheetMatch(json, { matchId });
    } catch (err) {
      if (c) {
        c.flagsByCode.fixture_unparseable = (c.flagsByCode.fixture_unparseable ?? 0) + 1;
        opts.onMatchError?.(matchId, err);
      }
      continue; // a match of another year that fails only gives no evidence
    }
    all.push(n);
    if (!c) continue;
    if (hasBatting(n)) c.withBatting++;
    if (n.meta.hasBallByBall) c.withBallByBall++;
    if (n.meta.superOver) c.superOverFixtures++;
    for (const f of n.flags) c.flagsByCode[f.code] = (c.flagsByCode[f.code] ?? 0) + 1;
    imported.push({ year, matchId: Number(matchId), n });
  }

  // 2. Identities from twins; then each imported match on Sportmonks ids where known.
  const sportmonks = await loadSportmonksLineups(opts.archive);
  const identities = identitiesFromTwins(all, sportmonks);
  const byYear = new Map<number, { startingAt: string; matchId: number; rows: ScoredPlayerMatch[] }[]>(years.map((y) => [y, []]));
  const unresolvedRows = new Map<string, UnresolvedPlayer>();
  const people = new Map<number, Map<string, boolean>>(years.map((y) => [y, new Map()])); // year -> csId -> linked
  for (const { year, matchId, n } of imported) {
    const linked = new Map<string, string>();
    for (const p of n.players) {
      const smId = identities.identities.get(p.playerId);
      if (smId !== undefined) linked.set(p.playerId, smId);
      people.get(year)!.set(p.playerId, smId !== undefined);
      if (smId !== undefined) continue;
      const team = p.teamId.slice('cs:'.length);
      const key = `${year}|${p.playerId}|${team}`;
      const row = unresolvedRows.get(key) ?? { year, csId: p.playerId, name: n.playerNames[p.playerId]!, team, matches: 0 };
      row.matches++;
      unresolvedRows.set(key, row);
    }
    const out = applyLinks(n, linked, { teamNames: sportmonks.teamNames });
    byYear.get(year)!.push({
      startingAt: out.meta.startingAt,
      matchId,
      rows: out.players.map((stats) => ({ meta: out.meta, stats, score: scorePlayerMatch(stats) })),
    });
  }

  // 3. Outputs.
  await mkdir(opts.historyDir, { recursive: true });
  for (const [year, bucket] of byYear) {
    bucket.sort((a, b) => cmp(a.startingAt, b.startingAt) || a.matchId - b.matchId);
    const lines = bucket.flatMap((b) => b.rows.map((r) => JSON.stringify(r) + '\n'));
    await writeFile(join(opts.historyDir, `ipl-${year}.jsonl`), lines.join(''));
  }

  for (const c of coverage.values()) c.flagsByCode = Object.fromEntries(Object.entries(c.flagsByCode).sort(([a], [b]) => cmp(a, b)));
  const covPath = join(opts.historyDir, 'coverage-cricsheet.json');
  const prevCov = (await readJsonOrNull(covPath)) as SeasonCoverage[] | null;
  const allCov = [...(Array.isArray(prevCov) ? prevCov.filter((c) => !coverage.has(c.year)) : []), ...coverage.values()].sort((a, b) => a.year - b.year);
  await writeFile(covPath, JSON.stringify(allCov, null, 2) + '\n');

  const unrPath = join(opts.historyDir, 'cricsheet-unresolved.json');
  const prevUnr = (await readJsonOrNull(unrPath)) as UnresolvedPlayer[] | null;
  const allUnr = [...(Array.isArray(prevUnr) ? prevUnr.filter((u) => !coverage.has(u.year)) : []), ...unresolvedRows.values()].sort(
    (a, b) => a.year - b.year || cmp(a.name, b.name) || cmp(a.csId, b.csId) || cmp(a.team, b.team),
  );
  await writeFile(unrPath, JSON.stringify(allUnr, null, 2) + '\n');

  const summary: ImportYearSummary[] = years.map((year) => {
    const ps = [...people.get(year)!.values()];
    const linked = ps.filter(Boolean).length;
    return { year, matches: byYear.get(year)!.length, players: ps.length, linked, unresolved: ps.length - linked };
  });
  return { coverage: [...coverage.values()], unresolved: allUnr.filter((u) => coverage.has(u.year)), summary, identities };
}
