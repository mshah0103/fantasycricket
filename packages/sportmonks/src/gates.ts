import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CricsheetLinks, ScoredPlayerMatch, SeasonCoverage } from './history.js';
import type { ArchiveEntry, RawArchive } from './archive.js';
import { buildScoreCatalog, dismissalKindFromScoreName, isSubstituteDismissal, runOutCreditedFielder, statusGroup, type ScoreCatalog } from './fieldMap.js';
import { normalizeFixture } from './normalize/index.js';
import { readRecording } from './record.js';
import { scorePlayerMatch } from '@fc/scoring';

/** Everything above and including this line is regenerated; everything below is hand-written. */
export const GATES_END_MARKER = '<!-- END GENERATED -->';

export interface GateReportInput {
  historyDir: string;
  recordingsDir: string;
  archive: RawArchive;
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
const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
const cmp = <T extends string | number>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);
const cell = (s: unknown): string => str(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function table(head: string[], rows: unknown[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

// ---------------------------------------------------------------------------
// Archive scan

interface IplFixture {
  id: string;
  year: number;
  data: Obj;
  batting: Obj[];
  lineupIds: Set<string>;
  names: Map<string, string>;
}

interface Scan {
  catalog: ScoreCatalog | null;
  fixtures: IplFixture[];
  iplLeagueId: string | null;
  seasonYear: Map<string, number>;
  latestFixtureEntry: Map<string, ArchiveEntry>;
  squadEntries: Map<string, ArchiveEntry>;
  maxFetchedAt: string;
}

async function scanArchive(archive: RawArchive): Promise<Scan> {
  let leagues: ArchiveEntry | undefined;
  let scores: ArchiveEntry | undefined;
  const seasonsLists: ArchiveEntry[] = [];
  const latestFixtureEntry = new Map<string, ArchiveEntry>();
  const squadEntries = new Map<string, ArchiveEntry>();
  let maxFetchedAt = '';
  const newer = (a: ArchiveEntry | undefined, b: ArchiveEntry) => (!a || b.fetchedAt >= a.fetchedAt ? b : a);
  for await (const e of archive.entries()) {
    if (e.fetchedAt > maxFetchedAt) maxFetchedAt = e.fetchedAt;
    if (!is2xx(e)) continue;
    if (e.endpoint === '/leagues') leagues = newer(leagues, e);
    else if (e.endpoint === '/scores') scores = newer(scores, e);
    else if (e.endpoint === '/seasons') seasonsLists.push(e);
    else {
      const f = /^\/fixtures\/(\d+)$/.exec(e.endpoint);
      if (f) latestFixtureEntry.set(f[1]!, newer(latestFixtureEntry.get(f[1]!), e));
      else if (/^\/teams\/\d+\/squad\/\d+$/.test(e.endpoint)) squadEntries.set(e.endpoint, newer(squadEntries.get(e.endpoint), e));
    }
  }
  const catalog = scores ? buildScoreCatalog(await archive.readBody(scores)) : null;

  let iplLeagueId: string | null = null;
  if (leagues) {
    const league = list(await archive.readBody(leagues)).find((l) => l.name === 'Indian Premier League');
    if (league) iplLeagueId = str(league.id);
  }
  const seasonYear = new Map<string, number>();
  for (const e of seasonsLists.sort((a, b) => cmp(a.fetchedAt, b.fetchedAt))) {
    for (const s of list(await archive.readBody(e))) {
      if (iplLeagueId !== null && str(s.league_id) !== iplLeagueId) continue;
      const m = /\d{4}/.exec(str(s.name));
      if (m) seasonYear.set(str(s.id), Number(m[0]));
    }
  }

  const fixtures: IplFixture[] = [];
  for (const [id, e] of latestFixtureEntry) {
    const d = unwrap(await archive.readBody(e));
    if (!isObj(d)) continue;
    if (iplLeagueId !== null && str(d.league_id) !== iplLeagueId) continue;
    const startMs = Date.parse(str(d.starting_at));
    const year = seasonYear.get(str(d.season_id)) ?? (Number.isNaN(startMs) ? undefined : new Date(startMs).getUTCFullYear());
    if (year === undefined) continue;
    const lineup = list(d.lineup);
    fixtures.push({
      id,
      year,
      data: d,
      batting: list(d.batting),
      lineupIds: new Set(lineup.map((p) => str(p.id))),
      names: new Map(lineup.map((p) => [str(p.id), str(p.fullname) || str(p.id)])),
    });
  }
  fixtures.sort((a, b) => a.year - b.year || Number(a.id) - Number(b.id));
  return { catalog, fixtures, iplLeagueId, seasonYear, latestFixtureEntry, squadEntries, maxFetchedAt };
}

const PENDING_NO_SCORES = 'Pending: no archived /scores body; run sm:pull-history first.';

// ---------------------------------------------------------------------------
// Gates 1-3 (archive)

const scoreName = (catalog: ScoreCatalog, rec: Obj): string => catalog.get(str(rec.score_id))?.name ?? '';
const idOrNull = (x: unknown): string | null => (typeof x === 'number' ? String(x) : null);

/**
 * The current run-out credit rule in words, found by probing `rule` (default `runOutCreditedFielder`), so that the
 * report follows the code when the commissioner changes the rule (FIELD_MAP §5.2).
 */
export function describeRunOutRule(rule: typeof runOutCreditedFielder = runOutCreditedFielder): { short: string; sentence: string } {
  const both = rule({ runout_by_id: 2, catch_stump_player_id: 1 });
  const loneCatchStump = rule({ runout_by_id: null, catch_stump_player_id: 1 }) !== null;
  const loneRunoutBy = rule({ runout_by_id: 2, catch_stump_player_id: null }) !== null;
  const primary = both === '2' ? '`runout_by_id`' : both === '1' ? '`catch_stump_player_id`' : null;
  const short =
    primary === '`runout_by_id`'
      ? `\`runout_by_id\`${loneCatchStump ? ', else `catch_stump_player_id`' : ' only'}`
      : primary === '`catch_stump_player_id`'
        ? `\`catch_stump_player_id\`${loneRunoutBy ? ', else `runout_by_id`' : ' only'}`
        : 'see `runOutCreditedFielder`';
  const sentence = [
    primary ? `with both ids the credited fielder is ${primary}` : 'with both ids no single fielder is credited',
    loneCatchStump ? 'a lone `catch_stump_player_id` is credited' : 'a lone `catch_stump_player_id` is not credited',
    loneRunoutBy ? 'a lone `runout_by_id` is credited' : 'a lone `runout_by_id` is not credited',
  ].join('; ');
  return { short, sentence: `${sentence}. A run-out with no credited fielder is flagged \`runout_fielder_missing\`.` };
}

function gate1(scan: Scan): string {
  if (!scan.catalog) return PENDING_NO_SCORES;
  const catalog = scan.catalog;
  const byYear = new Map<number, { total: number; ro: number; csOnly: number; none: number; credited: number }>();
  const twoFielder: { f: IplFixture; batter: string; cs: string; ro: string }[] = [];
  for (const f of scan.fixtures) {
    for (const rec of f.batting) {
      if (dismissalKindFromScoreName(scoreName(catalog, rec)) !== 'run_out') continue;
      const cs = typeof rec.catch_stump_player_id === 'number' ? rec.catch_stump_player_id : null;
      const ro = typeof rec.runout_by_id === 'number' ? rec.runout_by_id : null;
      const y = byYear.get(f.year) ?? { total: 0, ro: 0, csOnly: 0, none: 0, credited: 0 };
      y.total++;
      if (ro !== null) y.ro++;
      else if (cs !== null) y.csOnly++;
      else y.none++;
      if (runOutCreditedFielder({ runout_by_id: ro, catch_stump_player_id: cs }) !== null) y.credited++;
      byYear.set(f.year, y);
      if (ro !== null && cs !== null) {
        const nm = (id: number) => f.names.get(String(id)) ?? `(not in lineup: ${id})`;
        twoFielder.push({ f, batter: f.names.get(str(rec.player_id)) ?? str(rec.player_id), cs: nm(cs), ro: nm(ro) });
      }
    }
  }
  const years = [...byYear.keys()].sort(cmp);
  const sum = (k: 'total' | 'ro' | 'csOnly' | 'none' | 'credited') => years.reduce((s, y) => s + byYear.get(y)![k], 0);
  const rows = years.map((y) => {
    const v = byYear.get(y)!;
    return [y, v.total, v.ro, v.csOnly, v.none, pct(v.credited, v.total)];
  });
  rows.push(['all', sum('total'), sum('ro'), sum('csOnly'), sum('none'), pct(sum('credited'), sum('total'))]);
  // Most recent season first; within a season by fixture id then batter.
  twoFielder.sort((a, b) => b.f.year - a.f.year || Number(a.f.id) - Number(b.f.id) || cmp(a.batter, b.batter));
  const sample = twoFielder.slice(0, 10).map((s) => [s.f.id, s.f.year, str(s.f.data.round), str(s.f.data.starting_at).slice(0, 10), s.batter, s.cs, s.ro]);
  const rule = describeRunOutRule();
  return [
    `Run-outs per season and who the source names. "Credited" is the share with a fielder under the current rule (\`runOutCreditedFielder\`: ${rule.short}).`,
    '',
    table(['Season', 'Run-outs', 'With runout_by_id', 'Only catch_stump_player_id', 'Neither', 'Credited (current rule)'], rows),
    '',
    `Current rule (read from \`runOutCreditedFielder\`): ${rule.sentence} Which fielder to credit, and whether a lone \`catch_stump_player_id\` counts, is a pending commissioner decision (spec §5.6, FIELD_MAP §5.2).`,
    '',
    `Sample of ${sample.length} two-fielder run-outs (of ${twoFielder.length}) for the manual ESPNcricinfo check. \`catch_stump_player_id\` is the first fielder, \`runout_by_id\` the second:`,
    '',
    table(['Fixture', 'Season', 'Round', 'Date', 'Batter', 'catch_stump_player_id', 'runout_by_id'], sample),
  ].join('\n');
}

function gate2(scan: Scan): string {
  if (!scan.catalog) return PENDING_NO_SCORES;
  const catalog = scan.catalog;
  const byYear = new Map<number, { subs: number; withId: number; notInLineup: number }>();
  for (const f of scan.fixtures) {
    for (const rec of f.batting) {
      if (!isSubstituteDismissal(scoreName(catalog, rec))) continue;
      const y = byYear.get(f.year) ?? { subs: 0, withId: 0, notInLineup: 0 };
      y.subs++;
      const id = idOrNull(rec.catch_stump_player_id);
      if (id !== null) {
        y.withId++;
        if (!f.lineupIds.has(id)) y.notInLineup++;
      }
      byYear.set(f.year, y);
    }
  }
  const years = [...byYear.keys()].sort(cmp);
  const tot = years.reduce((s, y) => ({ subs: s.subs + byYear.get(y)!.subs, withId: s.withId + byYear.get(y)!.withId, notInLineup: s.notInLineup + byYear.get(y)!.notInLineup }), { subs: 0, withId: 0, notInLineup: 0 });
  const row = (label: string | number, v: { subs: number; withId: number; notInLineup: number }) => [label, v.subs, pct(v.withId, v.subs), pct(v.notInLineup, v.withId)];
  return [
    'Dismissals whose score name ends in `(Sub)`. "Missing from lineup" is the share of the substitute ids that are not in that fixture\'s `lineup`.',
    '',
    table(['Season', 'Substitute dismissals', 'With a player id', 'Ids missing from lineup'], [...years.map((y) => row(y, byYear.get(y)!)), row('all', tot)]),
  ].join('\n');
}

function gate3(scan: Scan): string {
  const codes = new Set<string>();
  const rows: unknown[][] = [];
  let withoutDetail = 0;
  for (const f of scan.fixtures) {
    const fixtureCodes = new Set<string>();
    for (const key of ['batting', 'bowling', 'balls']) for (const r of list(f.data[key])) if (typeof r.scoreboard === 'string') fixtureCodes.add(r.scoreboard);
    for (const c of fixtureCodes) codes.add(c);
    if (f.data.super_over !== true) continue;
    let missing = 'unknown';
    if (scan.catalog) {
      try {
        const n = normalizeFixture({ data: f.data }, scan.catalog);
        const m = n.flags.some((fl) => fl.code === 'ball_data_missing' && fl.playerId === undefined && fl.detail.includes('Super Over'));
        missing = m ? 'yes' : 'none detected';
        if (m) withoutDetail++;
      } catch {
        missing = 'unparseable';
      }
    }
    rows.push([f.id, f.year, str(f.data.round), [...fixtureCodes].sort(cmp).join(', '), missing]);
  }
  return [
    `Fixtures with \`super_over: true\`: ${rows.length}, of which ${withoutDetail} have no Super Over ball/innings detail (normalizer flag \`ball_data_missing\`). Scoreboard codes seen across all IPL fixtures in batting, bowling and balls: ${[...codes].sort(cmp).join(', ') || 'none'} (S1/S2 regulation, S3+ Super Over). Repeat Super Overs (a 3rd or later tie-break, known case 2020 m36 / 15267, FIELD_MAP §2.2) cannot be detected: \`runs[]\` stops at inning 4, so "none detected" means no gap is detectable, not that the data is complete.`,
    '',
    table(['Fixture', 'Season', 'Round', 'Scoreboard codes', 'Super Over detail missing'], rows),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Gates 4 and 6 (history)

async function readJson<T>(historyDir: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(historyDir, file), 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
const readCoverage = (historyDir: string, file = 'coverage.json') => readJson<SeasonCoverage[]>(historyDir, file);

async function bowlerInnings(historyDir: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  let files: string[] = [];
  try {
    files = await readdir(historyDir);
  } catch {
    return out;
  }
  for (const file of files.sort()) {
    const m = /^ipl-(\d{4})\.jsonl$/.exec(file);
    if (!m) continue;
    let n = 0;
    for (const line of (await readFile(join(historyDir, file), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as ScoredPlayerMatch;
      if (r.stats.regulation.bowling) n++;
      if (r.stats.superOver?.bowling) n++;
    }
    out.set(Number(m[1]), n);
  }
  return out;
}

async function gate4(historyDir: string): Promise<string> {
  const coverage = await readCoverage(historyDir);
  if (!coverage) return 'Pending: no history output; run sm:build-history first.';
  const innings = await bowlerInnings(historyDir);
  const rows = coverage
    .filter((c) => c.fixturesFetched > 0)
    .map((c) => {
      const bi = innings.get(c.year) ?? 0;
      const mm = c.flagsByCode.bowling_card_mismatch ?? 0;
      const bd = c.flagsByCode.ball_data_missing ?? 0;
      return [c.year, c.fixturesFetched, bi, mm, pct(mm, bi), bd, pct(bd, bi), c.flagsByCode.fixture_unparseable ?? 0];
    });
  const unparseable = coverage.reduce((s, c) => s + (c.flagsByCode.fixture_unparseable ?? 0), 0);
  return [
    'Flags per season from `coverage.json`; the rate is per bowler-innings (a player-phase with a bowling line in the history output). `ball_data_missing` counts every use of the card instead of balls, including the fixture-level Super Over flag.',
    '',
    table(['Season', 'Fixtures', 'Bowler-innings', 'bowling_card_mismatch', 'Mismatch rate', 'ball_data_missing', 'Missing rate', 'fixture_unparseable'], rows),
    ...(unparseable > 0 ? ['', `Warning: ${unparseable} fixture(s) failed to normalize (\`fixture_unparseable\`).`] : []),
  ].join('\n');
}

async function gate6(historyDir: string): Promise<string> {
  const coverage = await readCoverage(historyDir);
  if (!coverage) return 'Pending: no history output; run sm:build-history first.';
  const gaps = coverage.filter((c) => c.fixturesFetched === 0 || c.withBallByBall < c.fixturesFetched).map((c) => c.year);
  const lines = [
    table(
      ['Season', 'Season id', 'Listed', 'Fetched', 'With batting', 'With ball-by-ball', 'Super Over fixtures'],
      coverage.map((c) => [c.year, c.seasonId || '-', c.fixturesListed, c.fixturesFetched, c.withBatting, c.withBallByBall, c.superOverFixtures]),
    ),
    '',
    `Seasons with no fixtures or with fixtures lacking ball-by-ball: ${gaps.length ? gaps.join(', ') : 'none'}.`,
  ];
  // Task 12: the one-time Cricsheet import (spec §12.1) writes its own coverage next to Sportmonks'.
  const cricsheet = await readCoverage(historyDir, 'coverage-cricsheet.json');
  if (!cricsheet) return lines.join('\n');
  const flagText = (c: SeasonCoverage): string => Object.entries(c.flagsByCode).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
  const smYears = coverage.filter((c) => c.fixturesFetched > 0).map((c) => c.year);
  const csYears = cricsheet.filter((c) => c.fixturesFetched > 0 && !smYears.includes(c.year)).map((c) => c.year);
  const allYears = [...new Set([...coverage, ...cricsheet].map((c) => c.year))];
  const neither = allYears.filter((y) => !smYears.includes(y) && !csYears.includes(y));
  return [
    ...lines,
    '',
    'Cricsheet (one-time import for seasons Sportmonks lacks, spec §12.1; from `coverage-cricsheet.json`. Listed and Fetched both count the Cricsheet match files dated in that year):',
    '',
    table(
      ['Season', 'Season id', 'Listed', 'Fetched', 'With batting', 'With ball-by-ball', 'Super Over fixtures', 'Flags'],
      cricsheet.map((c) => [c.year, c.seasonId, c.fixturesListed, c.fixturesFetched, c.withBatting, c.withBallByBall, c.superOverFixtures, flagText(c)]),
    ),
    '',
    `Source per season: Sportmonks ${yearRanges(smYears)}; Cricsheet ${yearRanges(csYears)}${neither.length ? `; neither ${yearRanges(neither)}` : ''}.`,
    ...cricsheetLinking(await readJson<CricsheetLinks>(historyDir, 'cricsheet-links.json')),
  ].join('\n');
}

/** Gate 6 subsection from `cricsheet-links.json` (written by `cs:import`); nothing when the file is absent. */
function cricsheetLinking(links: CricsheetLinks | null): string[] {
  if (!links) return [];
  const cross = links.crossEraUnresolved;
  return [
    '',
    '### Cricsheet player linking',
    '',
    `From \`cricsheet-links.json\`. Cricsheet players are put on Sportmonks player ids by their Cricsheet registry id, from the ${links.twinsUsed} Cricsheet matches paired with their Sportmonks fixture (name rule, plus the same-team unique surname inside those matches): ${links.identitiesLinked} Cricsheet players have a Sportmonks id. Everyone else keeps a \`cs:\` player id.`,
    '',
    table(['Season', 'Players', 'Linked', 'Unresolved'], links.perYear.map((r) => [r.year, r.players, r.linked, r.unresolved])),
    '',
    `Unresolved players who also play in a Cricsheet match of a season Sportmonks covers (played into the Sportmonks era but not linked): ${cross.length}.`,
    ...(cross.length ? ['', table(['Cricsheet id', 'Name', 'Team', 'Seasons'], cross.map((r) => [r.csId, r.name, r.team, yearRanges(r.years)]))] : []),
    '',
    'Franchises renamed since 2008–2012 (e.g. Delhi Daredevils, Kings XI Punjab, Royal Challengers Bangalore) keep `cs:` team ids; Sportmonks only has current team names.',
  ];
}

/** `[2008, 2009, 2010, 2013]` -> `2008–2010, 2013`; empty -> `none`. */
function yearRanges(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j]! + 1) j++;
    out.push(j === i ? String(ys[i]) : `${ys[i]}–${ys[j]}`);
    i = j + 1;
  }
  return out.join(', ') || 'none';
}

// ---------------------------------------------------------------------------
// Gates 5 and 7 (recordings)

interface Recording {
  name: string;
  snaps: { seq: number; fetchedAt: string; body: unknown }[];
}

async function readRecordings(dir: string): Promise<Recording[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: Recording[] = [];
  for (const name of names.sort(cmp)) {
    const snaps: Recording['snaps'] = [];
    for await (const s of readRecording(join(dir, name))) snaps.push(s);
    if (snaps.length) out.push({ name, snaps });
  }
  return out;
}

const dataOf = (body: unknown): Obj => (isObj(body) && isObj(body.data) ? body.data : {});
const lineupCount = (d: Obj): number => list(d.lineup).length;
const NO_RECORDINGS = 'Pending: no recordings yet (Big Bash trial). Record with `sm:record --fixture <id>`.';

function gate5(recs: Recording[]): string {
  if (!recs.length) return NO_RECORDINGS;
  const rows = recs.map((r) => {
    const first = r.snaps.find((s) => lineupCount(dataOf(s.body)) > 0);
    const startingAt = str(dataOf(r.snaps[0]!.body).starting_at);
    if (!first) return [r.name, startingAt, r.snaps.length, 'never', 'lineup never appeared'];
    const mins = (Date.parse(first.fetchedAt) - Date.parse(startingAt)) / 60_000;
    return [r.name, startingAt, r.snaps.length, first.fetchedAt, Number.isNaN(mins) ? 'n/a' : (mins).toFixed(1)];
  });
  return [
    'Minutes from the first snapshot that has a lineup to `starting_at`. Negative means the lineup was there before the start. A recording started after the lineup appeared shows only an upper bound.',
    '',
    table(['Fixture', 'starting_at', 'Snapshots', 'First lineup snapshot', 'Minutes vs start'], rows),
  ].join('\n');
}

async function gate7(recs: Recording[], scan: Scan, archive: RawArchive): Promise<string> {
  if (!recs.length) return NO_RECORDINGS;
  if (!scan.catalog) return PENDING_NO_SCORES;
  const catalog = scan.catalog;
  /** Half-points per player, or the first line of the normalizer's error (a bad snapshot is reported, as in gate 3). */
  const scoresOf = (body: unknown): Map<string, number> | { error: string } => {
    try {
      const m = new Map<string, number>();
      for (const p of normalizeFixture(body, catalog).players) m.set(p.playerId, scorePlayerMatch(p).totalHalfPoints);
      return m;
    } catch (e) {
      return { error: (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 120) };
    }
  };
  /** "N player(s) changed" + details; a player with no record on one side is "absent", not 0. */
  type Side = { label: string; name: string; body: unknown };
  const compare = (a: Side, b: Side): string[] => {
    const head = `${a.label} vs ${b.label}`;
    const before = scoresOf(a.body);
    const after = scoresOf(b.body);
    if (!(before instanceof Map)) return [`- ${head}: cannot compare: ${a.name} does not normalize (${before.error}).`];
    if (!(after instanceof Map)) return [`- ${head}: cannot compare: ${b.name} does not normalize (${after.error}).`];
    const fmt = (v: number | undefined): string => (v === undefined ? 'absent' : `${v}`);
    const out: string[] = [];
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort((p, q) => Number(p) - Number(q))) {
      const [u, v] = [before.get(id), after.get(id)];
      if (u !== v) out.push(`  - player ${id}: ${fmt(u)} -> ${fmt(v)}${v === undefined ? '' : ' half-points'}`);
    }
    return [`- ${head}: ${out.length ? `${out.length} player(s) changed` : 'no score changes'}.`, ...out];
  };
  const lines: string[] = [];
  for (const r of recs) {
    const last = r.snaps[r.snaps.length - 1]!;
    const firstFinished = r.snaps.find((s) => statusGroup(str(dataOf(s.body).status)) === 'finished');
    const fixtureId = str(dataOf(last.body).id) || r.name;
    lines.push(`### Fixture ${fixtureId} (${r.name})`, '');
    if (!firstFinished) {
      lines.push('- No finished snapshot yet; nothing to compare.');
    } else if (firstFinished.seq === last.seq) {
      lines.push(`- Only one finished snapshot (#${last.seq}); no post-match snapshot to compare against.`);
    } else {
      lines.push(
        ...compare(
          { label: `First finished snapshot #${firstFinished.seq} (${firstFinished.fetchedAt})`, name: `snapshot #${firstFinished.seq}`, body: firstFinished.body },
          { label: `last snapshot #${last.seq} (${last.fetchedAt})`, name: `snapshot #${last.seq}`, body: last.body },
        ),
      );
    }
    const entry = scan.latestFixtureEntry.get(fixtureId);
    if (!entry || entry.fetchedAt <= last.fetchedAt) {
      lines.push('- No history pull of this fixture after the last snapshot in the archive; pull it later to compare.');
    } else {
      lines.push(
        ...compare(
          { label: `Last snapshot #${last.seq}`, name: `snapshot #${last.seq}`, body: last.body },
          { label: `the history pull at ${entry.fetchedAt}`, name: 'the history pull', body: await archive.readBody(entry) },
        ),
      );
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Gate 8 (squads)

const POSITION_MAPPING: [string, string][] = [
  ['3 Wicketkeeper', 'WK'],
  ['1 Batsman, 5 Top Order Batter, 8 Middle Order Batter', 'BAT'],
  ['4 Allrounder, 11 Bowling Allrounder, 14 Batting Allrounder', 'ALL'],
  ['2 Bowler', 'BWL'],
];

function squadPlayers(body: unknown): Obj[] {
  const d = unwrap(body);
  if (Array.isArray(d)) return d.filter(isObj);
  if (isObj(d)) {
    const s = d.squad;
    if (Array.isArray(s)) return s.filter(isObj);
    if (isObj(s) && Array.isArray(s.data)) return s.data.filter(isObj);
  }
  return [];
}

async function gate8(scan: Scan, archive: RawArchive): Promise<string> {
  const pending = 'Pending: pull after the 16 December 2026 auction (`pnpm sm:pull-squads --year 2027`).';
  const season2027 = [...scan.seasonYear].find(([, y]) => y === 2027)?.[0];
  if (!season2027) return `${pending} No IPL 2027 season is in the archived /seasons bodies yet.`;
  const entries = [...scan.squadEntries.values()].filter((e) => e.endpoint.endsWith(`/squad/${season2027}`));
  if (!entries.length) return `${pending} Season ${season2027} is known but has no archived squads.`;
  const players = new Map<string, { name: string; positionId: string; positionName: string; teamId: string }>();
  for (const e of entries.sort((a, b) => cmp(a.endpoint, b.endpoint))) {
    const teamId = /\/teams\/(\d+)\//.exec(e.endpoint)![1]!;
    for (const p of squadPlayers(await archive.readBody(e))) {
      const pos = isObj(p.position) ? p.position : {};
      players.set(str(p.id), {
        name: str(p.fullname) || [str(p.firstname), str(p.lastname)].filter(Boolean).join(' ') || str(p.id),
        positionId: str(pos.id ?? p.position_id),
        positionName: str(pos.name),
        teamId,
      });
    }
  }
  const all = [...players.entries()];
  const missing = all.filter(([, p]) => p.positionId === '');
  const dist = new Map<string, number>();
  for (const [, p] of all) if (p.positionId !== '') dist.set(`${p.positionId} ${p.positionName}`.trim(), (dist.get(`${p.positionId} ${p.positionName}`.trim()) ?? 0) + 1);
  return [
    `IPL 2027 season ${season2027}: ${entries.length} team squad(s), ${all.length} players. With a position: ${all.length - missing.length}. Without: ${missing.length}.`,
    '',
    missing.length ? table(['Player id', 'Name', 'Team id'], missing.map(([id, p]) => [id, p.name, p.teamId])) : 'No squad player is missing a position.',
    '',
    'Position distribution:',
    '',
    table(['Position', 'Players'], [...dist].sort(([a], [b]) => cmp(a, b)).map(([k, v]) => [k, v])),
    '',
    'Suggested mapping (needs commissioner confirmation):',
    '',
    table(['Sportmonks position', 'App position'], POSITION_MAPPING),
  ].join('\n');
}

// ---------------------------------------------------------------------------

export async function buildGateReport(input: GateReportInput): Promise<string> {
  const scan = await scanArchive(input.archive);
  const recs = await readRecordings(input.recordingsDir);
  const generatedFrom = scan.maxFetchedAt || 'an empty archive';
  const sections: [string, string][] = [
    ['Gate 1: run-out credit', gate1(scan)],
    ['Gate 2: substitute fielders', gate2(scan)],
    ['Gate 3: Super Overs', gate3(scan)],
    ['Gate 4: ball-by-ball vs bowling card', await gate4(input.historyDir)],
    ['Gate 5: lineup timing', gate5(recs)],
    ['Gate 6: season coverage', await gate6(input.historyDir)],
    ['Gate 7: latency and post-match corrections', await gate7(recs, scan, input.archive)],
    ['Gate 8: IPL 2027 positions', await gate8(scan, input.archive)],
  ];
  return [
    '# Sportmonks verification report',
    '',
    `Generated from archive data up to ${generatedFrom} (spec §12.3). Gates 1-4 and 6 are IPL only; gates 5 and 7 cover recordings of any league. Sections above the end marker are regenerated by \`sm:gates\`; add manual checks below it.`,
    '',
    ...sections.flatMap(([h, body]) => [`## ${h}`, '', body, '']),
    GATES_END_MARKER,
    '',
  ].join('\n');
}

/**
 * Replaces the generated part of an existing report and keeps everything after the end marker.
 * `existing === null` means no file yet: the generated part is followed by empty manual headings.
 * An existing file without the marker is refused rather than overwritten.
 */
export function mergeGateReport(existing: string | null, generated: string): string {
  if (existing === null) return `${generated.trimEnd()}\n\n## Manual checks\n\n## Spec impact\n`;
  const i = existing.indexOf(GATES_END_MARKER);
  if (i < 0) throw new Error(`Existing report has no "${GATES_END_MARKER}" line; refusing to overwrite it. Add the line or move the file.`);
  const j = generated.indexOf(GATES_END_MARKER);
  return generated.slice(0, j + GATES_END_MARKER.length) + existing.slice(i + GATES_END_MARKER.length);
}
