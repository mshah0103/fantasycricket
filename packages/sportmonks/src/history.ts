import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scorePlayerMatch, type DataFlag, type PlayerMatchStats, type ScoreResult } from '@fc/scoring';
import type { ArchiveEntry, RawArchive } from './archive.js';
import { buildScoreCatalog } from './fieldMap.js';
import { normalizeFixture, type NormalizedFixture } from './normalize/index.js';
import type { FixtureMeta } from './normalize/meta.js';

export interface ScoredPlayerMatch {
  meta: FixtureMeta;
  stats: PlayerMatchStats;
  score: ScoreResult;
}

/**
 * One line of `ipl-<year>-fixtures.jsonl`: a fixture and every flag the normalizer raised for it, fixture-level
 * (no `playerId`, e.g. a Super Over without ball detail) and player-level alike. `ScoredPlayerMatch` carries only
 * the flags on a player's own record; this is the complete record. Same fixture order as `ipl-<year>.jsonl`.
 */
export interface HistoryFixtureRecord {
  meta: FixtureMeta;
  flags: DataFlag[];
}

/**
 * `flagsByCode` is `Record<string, number>`, not keyed by `FlagCode`: besides the normalizer's flags it
 * holds `fixture_unparseable`, the number of fixtures for which `normalizeFixture` threw. Per-record
 * `unparseable_record` keeps its normalizer meaning.
 */
export interface SeasonCoverage {
  year: number;
  seasonId: string;
  fixturesListed: number;
  fixturesFetched: number;
  withBatting: number;
  withBallByBall: number;
  superOverFixtures: number;
  flagsByCode: Record<string, number>;
}

/**
 * `cricsheet-links.json`, written by the Cricsheet import (`cs:import`) and shown in the verification report
 * (gate 6): how Cricsheet players of the imported seasons were put on Sportmonks player ids.
 */
export interface CricsheetLinks {
  /** Cricsheet matches paired with their Sportmonks fixture (the identity evidence). */
  twinsUsed: number;
  /** Cricsheet players (registry ids) with a Sportmonks player id. */
  identitiesLinked: number;
  /** Per imported season; player counts are distinct Cricsheet ids. */
  perYear: { year: number; players: number; linked: number; unresolved: number }[];
  /**
   * Unresolved players of the imported seasons whose Cricsheet id also appears in a Cricsheet match of a season
   * Sportmonks covers: they played into the Sportmonks era but were not linked. `team` lists their teams in the
   * imported seasons; `years` the imported seasons they are unresolved in.
   */
  crossEraUnresolved: { csId: string; name: string; team: string; years: number[] }[];
}

export interface BuildHistoryOptions {
  /** With both bounds (or either), every year in range appears in coverage.json, even with no data. */
  fromYear?: number;
  toYear?: number;
  /** Called for a fixture that could not be processed (normalizer threw, or no season/year resolvable). */
  onFixtureError?: (fixtureId: string, error: unknown) => void;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const unwrap = (x: unknown): unknown => (isObj(x) && 'data' in x ? x.data : x);
const list = (x: unknown): Obj[] => {
  const v = unwrap(x);
  return Array.isArray(v) ? v.filter(isObj) : [];
};
const str = (x: unknown): string => (x === null || x === undefined ? '' : String(x));
const is2xx = (e: ArchiveEntry) => e.status >= 200 && e.status < 300;

/** Latest wins: later `fetchedAt`, ties go to the later manifest line. */
function keepLatest(map: Map<string, ArchiveEntry>, key: string, e: ArchiveEntry): void {
  const cur = map.get(key);
  if (!cur || e.fetchedAt >= cur.fetchedAt) map.set(key, e);
}

function emptyCoverage(year: number, seasonId = ''): SeasonCoverage {
  return { year, seasonId, fixturesListed: 0, fixturesFetched: 0, withBatting: 0, withBallByBall: 0, superOverFixtures: 0, flagsByCode: {} };
}

const hasBatting = (p: PlayerMatchStats) => p.regulation.batting !== null || p.superOver?.batting != null;

/**
 * Scores every archived IPL fixture (latest 2xx body per fixture) and writes `ipl-<year>.jsonl` (one
 * `ScoredPlayerMatch` per player), `ipl-<year>-fixtures.jsonl` (one `HistoryFixtureRecord` per fixture) and
 * `coverage.json` into `outDir`. Output is deterministic (no timestamps) and nothing else in `outDir` is touched.
 */
export async function buildHistory(
  archive: RawArchive,
  outDir: string,
  opts: BuildHistoryOptions = {},
): Promise<SeasonCoverage[]> {
  // One pass over the manifest: latest entry per interesting endpoint.
  let leagues: ArchiveEntry | undefined;
  let scores: ArchiveEntry | undefined;
  const seasonsLists: ArchiveEntry[] = [];
  const seasonFixtureLists = new Map<string, ArchiveEntry>();
  const fixtures = new Map<string, ArchiveEntry>();
  for await (const e of archive.entries()) {
    if (!is2xx(e)) continue;
    if (e.endpoint === '/leagues') leagues = !leagues || e.fetchedAt >= leagues.fetchedAt ? e : leagues;
    else if (e.endpoint === '/scores') scores = !scores || e.fetchedAt >= scores.fetchedAt ? e : scores;
    else if (e.endpoint === '/seasons') seasonsLists.push(e);
    else {
      const s = /^\/seasons\/(\d+)$/.exec(e.endpoint);
      if (s) {
        if (e.params.include?.split(',').includes('fixtures')) keepLatest(seasonFixtureLists, s[1]!, e);
        continue;
      }
      const f = /^\/fixtures\/(\d+)$/.exec(e.endpoint);
      if (f) keepLatest(fixtures, f[1]!, e);
    }
  }
  if (!scores) throw new Error('buildHistory: no archived /scores body; run sm:pull-history first');
  const catalog = buildScoreCatalog(await archive.readBody(scores));

  // IPL league id. Without an archived /leagues body (synthetic test archives) every fixture counts as IPL.
  let iplLeagueId: string | null = null;
  if (leagues) {
    const league = list(await archive.readBody(leagues)).find((l) => l.name === 'Indian Premier League');
    if (!league) throw new Error('buildHistory: "Indian Premier League" not found in archived /leagues');
    iplLeagueId = str(league.id);
  }

  // season id -> year, from every archived /seasons body (later bodies override earlier ones).
  const seasonYear = new Map<string, number>();
  for (const e of seasonsLists.sort((a, b) => (a.fetchedAt < b.fetchedAt ? -1 : a.fetchedAt > b.fetchedAt ? 1 : 0))) {
    for (const s of list(await archive.readBody(e))) {
      if (iplLeagueId !== null && str(s.league_id) !== iplLeagueId) continue;
      const m = /\d{4}/.exec(str(s.name));
      if (m) seasonYear.set(str(s.id), Number(m[0]));
    }
  }

  const coverage = new Map<number, SeasonCoverage>();
  const cov = (year: number, seasonId: string): SeasonCoverage => {
    let c = coverage.get(year);
    if (!c) coverage.set(year, (c = emptyCoverage(year, seasonId)));
    else if (!c.seasonId) c.seasonId = seasonId;
    return c;
  };

  for (const [seasonId, e] of seasonFixtureLists) {
    const year = seasonYear.get(seasonId);
    if (year === undefined) continue;
    const season = unwrap(await archive.readBody(e));
    cov(year, seasonId).fixturesListed += isObj(season) ? list(season.fixtures).length : 0;
  }

  const byYear = new Map<number, { startingAt: string; fixtureId: number; rows: ScoredPlayerMatch[]; fixture: HistoryFixtureRecord }[]>();
  for (const [fixtureId, e] of fixtures) {
    const raw = await archive.readBody(e);
    const d = unwrap(raw);
    const rawObj = isObj(d) ? d : {};
    if (iplLeagueId !== null && str(rawObj.league_id) !== iplLeagueId) continue;
    const seasonId = str(rawObj.season_id);
    const startMs = Date.parse(str(rawObj.starting_at));
    const year = seasonYear.get(seasonId) ?? (Number.isNaN(startMs) ? undefined : new Date(startMs).getUTCFullYear());
    if (year === undefined) {
      opts.onFixtureError?.(fixtureId, new Error('no season or year could be resolved for this fixture'));
      continue;
    }

    const c = cov(year, seasonId);
    c.fixturesFetched++;
    let n: NormalizedFixture;
    try {
      n = normalizeFixture(raw, catalog);
    } catch (err) {
      c.flagsByCode.fixture_unparseable = (c.flagsByCode.fixture_unparseable ?? 0) + 1;
      opts.onFixtureError?.(fixtureId, err);
      continue;
    }
    if (n.players.some(hasBatting)) c.withBatting++;
    if (n.meta.hasBallByBall) c.withBallByBall++;
    if (n.meta.superOver) c.superOverFixtures++;
    for (const f of n.flags) c.flagsByCode[f.code] = (c.flagsByCode[f.code] ?? 0) + 1;

    const rows = n.players.map((stats) => ({ meta: n.meta, stats, score: scorePlayerMatch(stats) }));
    const bucket = byYear.get(year) ?? [];
    bucket.push({ startingAt: n.meta.startingAt, fixtureId: Number(fixtureId), rows, fixture: { meta: n.meta, flags: n.flags } });
    byYear.set(year, bucket);
  }

  if (opts.fromYear !== undefined || opts.toYear !== undefined) {
    const years = [...coverage.keys()];
    const from = opts.fromYear ?? Math.min(...years);
    const to = opts.toYear ?? Math.max(...years);
    for (let y = from; y <= to; y++) if (!coverage.has(y)) coverage.set(y, emptyCoverage(y));
  }

  await mkdir(outDir, { recursive: true });
  for (const [year, bucket] of byYear) {
    bucket.sort((a, b) => (a.startingAt < b.startingAt ? -1 : a.startingAt > b.startingAt ? 1 : a.fixtureId - b.fixtureId));
    const lines = bucket.flatMap((b) => b.rows.map((r) => JSON.stringify(r) + '\n'));
    await writeFile(join(outDir, `ipl-${year}.jsonl`), lines.join(''));
    await writeFile(join(outDir, `ipl-${year}-fixtures.jsonl`), bucket.map((b) => JSON.stringify(b.fixture) + '\n').join(''));
  }

  const result = [...coverage.values()].sort((a, b) => a.year - b.year);
  for (const c of result) c.flagsByCode = Object.fromEntries(Object.entries(c.flagsByCode).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  await writeFile(join(outDir, 'coverage.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
