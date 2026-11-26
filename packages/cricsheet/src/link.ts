import { z } from 'zod';
import type { DataFlag, PlayerMatchStats } from '@fc/scoring';
import type { CricsheetFixture } from './normalize.js';

/** A Sportmonks player as seen in a fixture lineup: id, `fullname`, and the lineup team id. */
export interface SportmonksPlayerRef {
  id: string;
  name: string;
  teamId: string;
}

export interface LinkOptions {
  /** Sportmonks team id -> team name, for the tie-break between several candidates and for team ids. */
  teamNames?: ReadonlyMap<string, string>;
  /**
   * Same-team surname fallback (final-review ruling). Only for a pool that is the lineup of this match's own
   * Sportmonks fixture (its twin), and only with `teamNames`. A player with no name candidate is linked to the
   * player of his team (Sportmonks team name equal to his Cricsheet team) whose surname is equal, when that
   * surname is unique on that team on both sides: "KL Rahul" is "Lokesh Rahul". The usual guard still applies:
   * two Cricsheet players on one Sportmonks id are both unresolved.
   */
  sameTeamSurname?: boolean;
}

export interface LinkResult {
  /** Cricsheet player id -> Sportmonks player id. */
  linked: Map<string, string>;
  /** Cricsheet player ids with no single Sportmonks candidate, sorted. */
  unresolved: string[];
}

// ---------------------------------------------------------------------------
// Names

/** Surname particles kept with the surname: "F du Plessis" and "Faf du Plessis" both have surname "du plessis". */
const PARTICLES: ReadonlySet<string> = new Set(['da', 'de', 'den', 'der', 'di', 'du', 'la', 'le', 'ten', 'ter', 'van', 'von']);

/** Lower case, no accents, no apostrophes, periods or hyphens ("O'Rourke" = "orourke", "Fraser-McGurk" = "frasermcgurk"). */
const clean = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`.-]/g, '').toLowerCase();

interface ParsedName {
  /** Letters of a leading initials token ("MR" in "MR Marsh"); empty when the name starts with a full name. */
  initials: string[];
  /** Full given-name tokens (Cricsheet: after the initials; Sportmonks: everything before the surname). */
  given: string[];
  surname: string;
}

/** Splits off the surname: the last token, or from the first particle (not the first token) to the end. */
function splitSurname(tokens: string[], firstMayBeParticle: boolean): { given: string[]; surname: string } {
  let start = tokens.length - 1;
  for (let k = firstMayBeParticle ? 0 : 1; k < tokens.length - 1; k++) {
    if (PARTICLES.has(tokens[k]!)) {
      start = k;
      break;
    }
  }
  return { given: tokens.slice(0, start), surname: tokens.slice(start).join(' ') };
}

/** Cricsheet names are "Initials Surname" ("MR Marsh"), "Initials Given Surname" ("B Sai Sudharsan") or "Given Surname" ("Shubman Gill"). */
function parseCricsheetName(name: string): ParsedName | null {
  const raw = name.trim().split(/\s+/).filter(Boolean);
  const hasInitials = raw.length >= 2 && /^[A-Z]{1,4}$/.test(raw[0]!);
  const initials = hasInitials ? clean(raw[0]!).split('') : [];
  const rest = (hasInitials ? raw.slice(1) : raw).map(clean).filter(Boolean);
  if (rest.length === 0) return null;
  const { given, surname } = splitSurname(rest, hasInitials);
  return { initials, given, surname };
}

/** Sportmonks `fullname` ("Mitchell Marsh", "Akash Maharaj Singh"). */
function parseSportmonksName(name: string): ParsedName | null {
  const tokens = name.trim().split(/\s+/).map(clean).filter(Boolean);
  if (tokens.length === 0) return null;
  const { given, surname } = splitSurname(tokens, false);
  return { initials: [], given, surname };
}

/**
 * Whether a Cricsheet name can be this Sportmonks player. The surname must be equal. Then:
 * - only initials ("MR Marsh"): the first initial must be the first letter of the first Sportmonks given name;
 * - full given names ("Shubman Gill", "B Sai Sudharsan", "M Shahrukh Khan"): each must be a Sportmonks given
 *   name. Leading initials are not checked here, because they are often family initials Sportmonks leaves out
 *   ("B Sai Sudharsan" is "Sai Sudharsan"), and the full name already rules out e.g. "Mohsin Khan".
 * A bare surname never matches.
 */
function compatible(cs: ParsedName, sm: ParsedName): boolean {
  if (cs.surname !== sm.surname) return false;
  if (cs.given.length > 0) return cs.given.every((g) => sm.given.includes(g));
  const first = sm.given[0];
  return cs.initials.length > 0 && first !== undefined && first[0] === cs.initials[0];
}

// ---------------------------------------------------------------------------
// Linking

interface PoolEntry {
  id: string;
  teamId: string;
  parsed: ParsedName;
}
/** Pool indexed by surname; cached per pool array (the CLI links every match against one pool). */
const poolCache = new WeakMap<readonly SportmonksPlayerRef[], Map<string, PoolEntry[]>>();
function indexPool(pool: readonly SportmonksPlayerRef[]): Map<string, PoolEntry[]> {
  let index = poolCache.get(pool);
  if (index) return index;
  index = new Map();
  for (const p of pool) {
    const parsed = parseSportmonksName(p.name);
    if (!parsed) continue;
    const list = index.get(parsed.surname) ?? [];
    list.push({ id: p.id, teamId: p.teamId, parsed });
    index.set(parsed.surname, list);
  }
  poolCache.set(pool, index);
  return index;
}

const teamNameOf = (teamId: string): string => (teamId.startsWith('cs:') ? teamId.slice(3) : teamId);

/**
 * Links each Cricsheet player of one match to a Sportmonks player id (Task 12 notes).
 * Candidates: Sportmonks players whose name is `compatible` (surname + first initial, or full given names).
 * Exactly one candidate -> linked. Several -> those listed (in any entry) on a team whose name equals the
 * player's Cricsheet team in this match; exactly one left -> linked. None -> with `sameTeamSurname`, the
 * same-team unique surname (see `LinkOptions`). Otherwise unresolved: never guesses.
 * Two Cricsheet players of the match on one Sportmonks id are both unresolved. A Sportmonks player may
 * appear several times in the pool (one entry per team); that is one candidate.
 */
export function linkPlayers(
  cs: CricsheetFixture,
  sportmonksPlayers: readonly SportmonksPlayerRef[],
  opts: LinkOptions = {},
): LinkResult {
  const index = indexPool(sportmonksPlayers);
  const parsedById = new Map(cs.players.map((p) => [p.playerId, parseCricsheetName(cs.playerNames[p.playerId] ?? '')]));
  /** Cricsheet players of this match per `<cs team id>|<surname>`, for the same-team surname fallback. */
  const csSurnames = new Map<string, number>();
  for (const p of cs.players) {
    const parsed = parsedById.get(p.playerId);
    if (parsed) csSurnames.set(`${p.teamId}|${parsed.surname}`, (csSurnames.get(`${p.teamId}|${parsed.surname}`) ?? 0) + 1);
  }
  const proposed = new Map<string, string>();
  const unresolved: string[] = [];
  for (const p of cs.players) {
    const parsed = parsedById.get(p.playerId) ?? null;
    const sameSurname = parsed ? (index.get(parsed.surname) ?? []) : [];
    const entries = sameSurname.filter((e) => compatible(parsed!, e.parsed));
    let ids = [...new Set(entries.map((e) => e.id))];
    const team = teamNameOf(p.teamId);
    if (ids.length > 1 && opts.teamNames) {
      const onTeam = new Set(entries.filter((e) => opts.teamNames!.get(e.teamId) === team).map((e) => e.id));
      ids = ids.filter((id) => onTeam.has(id));
    } else if (ids.length === 0 && opts.sameTeamSurname && opts.teamNames && parsed) {
      const onTeam = new Set(sameSurname.filter((e) => opts.teamNames!.get(e.teamId) === team).map((e) => e.id));
      if (onTeam.size === 1 && csSurnames.get(`${p.teamId}|${parsed.surname}`) === 1) ids = [...onTeam];
    }
    if (ids.length === 1) proposed.set(p.playerId, ids[0]!);
    else unresolved.push(p.playerId);
  }
  const uses = new Map<string, number>();
  for (const smId of proposed.values()) uses.set(smId, (uses.get(smId) ?? 0) + 1);
  const linked = new Map<string, string>();
  for (const [csId, smId] of proposed) {
    if (uses.get(smId) === 1) linked.set(csId, smId);
    else unresolved.push(csId);
  }
  return { linked, unresolved: unresolved.sort() };
}

/** Numeric (Sportmonks) ids first, numerically; then the rest (`cs:` ids) as strings. */
export function comparePlayerIds(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A copy of the fixture with linked players on their Sportmonks ids (records, flags, names) and every team id
 * `cs:<name>` replaced by the Sportmonks team id with exactly that name, when there is one. Unresolved
 * players keep their `cs:` ids. Players are re-sorted with `comparePlayerIds`. The input is not modified.
 */
export function applyLinks(cs: CricsheetFixture, linked: ReadonlyMap<string, string>, opts: LinkOptions = {}): CricsheetFixture {
  const idsByName = new Map<string, string[]>();
  for (const [id, name] of opts.teamNames ?? []) idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  const team = (teamId: string): string => {
    const ids = teamId.startsWith('cs:') ? idsByName.get(teamId.slice(3)) : undefined;
    return ids?.length === 1 ? ids[0]! : teamId;
  };
  const player = (id: string): string => linked.get(id) ?? id;
  const flagCopies = new Map<DataFlag, DataFlag>();
  const copyFlag = (f: DataFlag): DataFlag => {
    let c = flagCopies.get(f);
    if (!c) flagCopies.set(f, (c = f.playerId === undefined ? { ...f } : { ...f, playerId: player(f.playerId) }));
    return c;
  };
  const flags = cs.flags.map(copyFlag);
  const players: PlayerMatchStats[] = cs.players
    .map((p) => ({
      fixtureId: p.fixtureId,
      playerId: player(p.playerId),
      teamId: team(p.teamId),
      regulation: structuredClone(p.regulation),
      superOver: structuredClone(p.superOver),
      flags: p.flags.map(copyFlag),
    }))
    .sort((a, b) => comparePlayerIds(a.playerId, b.playerId));
  const names = new Map(Object.entries(cs.playerNames).map(([id, name]) => [player(id), name]));
  return {
    meta: { ...cs.meta, localTeamId: team(cs.meta.localTeamId), visitorTeamId: team(cs.meta.visitorTeamId) },
    players,
    flags,
    playerNames: Object.fromEntries(players.map((p) => [p.playerId, names.get(p.playerId)!])),
  };
}

// ---------------------------------------------------------------------------
// Sportmonks side

const LineupEntry = z.object({ id: z.number().int(), fullname: z.string().min(1), lineup: z.object({ team_id: z.number().int() }) });
const BallTeam = z.object({ team: z.object({ id: z.number().int(), name: z.string().min(1) }) });
const FixtureBody = z.object({
  data: z.object({ lineup: z.array(z.unknown()).default([]), balls: z.array(z.unknown()).default([]) }),
});

/**
 * The lineup of one archived Sportmonks fixture body (`{ data: { lineup, balls } }`) as link candidates, and
 * team names from `balls[].team`. Entries that do not parse are skipped; a body that does not parse gives none.
 */
export function sportmonksLineupPlayers(body: unknown): { players: SportmonksPlayerRef[]; teamNames: Map<string, string> } {
  const parsed = FixtureBody.safeParse(body);
  const players: SportmonksPlayerRef[] = [];
  const teamNames = new Map<string, string>();
  if (!parsed.success) return { players, teamNames };
  for (const e of parsed.data.data.lineup) {
    const r = LineupEntry.safeParse(e);
    if (r.success) players.push({ id: String(r.data.id), name: r.data.fullname, teamId: String(r.data.lineup.team_id) });
  }
  for (const b of parsed.data.data.balls) {
    const r = BallTeam.safeParse(b);
    if (r.success && !teamNames.has(String(r.data.team.id))) teamNames.set(String(r.data.team.id), r.data.team.name);
  }
  return { players, teamNames };
}
