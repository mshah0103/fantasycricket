import { z } from 'zod';
import type { BattingStats, DataFlag, DismissalKind, FieldingStats, FlagCode, PhaseStats, PlayerMatchStats } from '@fc/scoring';
import { runOutCreditedFielder, type NormalizedFixture } from '@fc/sportmonks';

// Cricsheet JSON (format 1.3.0, https://cricsheet.org/format/json/) -> the same `NormalizedFixture` the
// Sportmonks normalizer produces, with the same semantics (FIELD_MAP §4–§7, spec §5). Only the fields used
// are declared; anything that would change a number (an unknown `extras` key) makes the match unparseable.
// Cricsheet files are untrusted data: callers JSON.parse them and pass the value here.

const Name = z.string().min(1);
const Count = z.number().int().nonnegative();
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'invalid date');

const DeliverySchema = z.object({
  batter: Name,
  bowler: Name,
  non_striker: Name,
  runs: z.object({ batter: Count, extras: Count, total: Count, non_boundary: z.boolean().optional() }),
  extras: z
    .object({ wides: Count.optional(), noballs: Count.optional(), byes: Count.optional(), legbyes: Count.optional(), penalty: Count.optional() })
    .strict()
    .optional(),
  wickets: z
    .array(
      z.object({
        kind: z.string(),
        player_out: Name,
        fielders: z.array(z.object({ name: Name.optional(), substitute: z.boolean().optional() })).optional(),
      }),
    )
    .optional(),
});
type Delivery = z.infer<typeof DeliverySchema>;

const MatchSchema = z.object({
  info: z.object({
    dates: z.array(IsoDate).min(1),
    teams: z.tuple([Name, Name]),
    players: z.record(z.array(Name)),
    registry: z.object({ people: z.record(z.string().min(1)) }),
    event: z.object({ match_number: z.number().int().optional(), stage: z.string().optional() }).optional(),
    outcome: z.object({ result: z.string().optional() }).optional(),
  }),
  innings: z
    .array(
      z.object({
        team: Name,
        super_over: z.boolean().optional(),
        overs: z.array(z.object({ over: Count, deliveries: z.array(DeliverySchema) })).default([]),
      }),
    )
    .default([]),
});

/** A normalized Cricsheet match: a `NormalizedFixture` plus each record's Cricsheet name (for linking). */
export interface CricsheetFixture extends NormalizedFixture {
  /** Player id -> the name Cricsheet uses for him in this match (e.g. `MR Marsh`). */
  playerNames: Record<string, string>;
}

export interface NormalizeCricsheetOptions {
  /** The match id (the file name, an ESPNcricinfo id). Without it the fixture id is a date-and-teams slug. */
  matchId?: string;
}

/** Cricsheet wicket `kind` -> `DismissalKind`. Kinds not listed get `unknown_dismissal` (as Sportmonks names do). */
const DISMISSAL_BY_KIND: ReadonlyMap<string, DismissalKind> = new Map([
  ['bowled', 'bowled'],
  ['caught', 'caught'], // upgraded to caught_and_bowled when the one fielder is the bowler (as Sportmonks)
  ['caught and bowled', 'caught_and_bowled'],
  ['lbw', 'lbw'],
  ['stumped', 'stumped'],
  ['hit wicket', 'hit_wicket'],
  ['run out', 'run_out'],
  ['retired hurt', 'retired_hurt'], // not a dismissal for the duck rule (the engine handles it)
  ['retired out', 'retired_out'],
  ['obstructing the field', 'obstructing_field'],
  ['handled the ball', 'handled_ball'],
  ['timed out', 'timed_out'],
  // 'hit the ball twice', 'retired not out' and anything new: unknown -> flagged.
]);

/** Dismissal kinds that credit the bowler with a wicket (spec §5.4; same set as the Sportmonks normalizer). */
const BOWLER_CREDITED: ReadonlySet<DismissalKind> = new Set<DismissalKind>([
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'hit_wicket',
]);

const emptyPhase = (): PhaseStats => ({ batting: null, bowling: null, fielding: { catches: 0, stumpings: 0, runOuts: 0 } });
const emptyBatting = (): BattingStats => ({ runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissal: null });
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The run-out credit rule shared with Sportmonks (`runOutCreditedFielder`, spec §5.6, FIELD_MAP §5.2).
 * Cricsheet has no `runout_by_id`, and its fielder order is not Sportmonks' (Task 12 ruling, based on the
 * gate 1 cross-check), so: exactly one fielder -> `catch_stump_player_id`; two or more -> neither (their order
 * cannot say whom Sportmonks credits); none -> neither. Sportmonks ids are numbers, so the fielder's 1-based
 * position stands in for it and is mapped back. Never picks between fielders.
 */
function creditedRunOutFielder(fielderIds: (string | null)[]): string | null {
  const only = fielderIds.length === 1 && fielderIds[0] !== null ? 1 : null;
  const pos = runOutCreditedFielder({ runout_by_id: null, catch_stump_player_id: only });
  return pos === null ? null : (fielderIds[Number(pos) - 1] ?? null);
}

interface BowlingTally {
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  dots: number;
  wideDeliveries: number;
  noBallDeliveries: number;
  /** `innings index|over` -> this bowler's legal balls and conceded runs in that over. */
  overs: Map<string, { legal: number; conceded: number }>;
}

/** The match's first date as a UTC year, or null if the value has no valid `info.dates[0]`. */
export function cricsheetMatchYear(json: unknown): number | null {
  const r = z.object({ info: z.object({ dates: z.array(IsoDate).min(1) }) }).safeParse(json);
  return r.success ? Number(r.data.info.dates[0]!.slice(0, 4)) : null;
}

/**
 * One Cricsheet match -> one `PlayerMatchStats` per player (every `info.players` entry, plus any fielder named
 * in a wicket who is not one of them, e.g. a substitute), sorted by player id. Ids are prefixed `cs:`:
 * players `cs:<registry id>`, teams `cs:<team name>`, league `cs:ipl`, season `cs:<year>`. Innings marked
 * `super_over: true` are the Super Over phase. Flags follow the Sportmonks normalizer: every flag is in
 * `flags`, and one about a player is also on his record. Throws if the value is not a parseable match.
 */
export function normalizeCricsheetMatch(json: unknown, opts: NormalizeCricsheetOptions = {}): CricsheetFixture {
  const label = opts.matchId === undefined ? '' : ` ${opts.matchId}`;
  const parsed = MatchSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Unparseable Cricsheet match${label}: ${issues.join('; ')}`);
  }
  const { info, innings } = parsed.data;
  const [team1, team2] = info.teams;
  const date = info.dates[0]!;
  const fixtureId = `cs:${opts.matchId ?? `${date}-${slug(team1)}-${slug(team2)}`}`;
  const fail = (why: string): never => {
    throw new Error(`Cricsheet match${label} (${fixtureId}): ${why}`);
  };
  for (const team of Object.keys(info.players)) if (team !== team1 && team !== team2) fail(`info.players team "${team}" is not in info.teams`);
  const otherTeam = (team: string): string => (team === team1 ? team2 : team1);

  const players = new Map<string, PlayerMatchStats>();
  const names = new Map<string, string>();
  const flags: DataFlag[] = [];
  const registryId = (name: string): string | null => {
    const id = info.registry.people[name];
    return id === undefined ? null : `cs:${id}`;
  };
  /** The record of the player with this registry id, created on `team` if absent (an existing record keeps its team). */
  const ensureId = (id: string, name: string, team: string): PlayerMatchStats => {
    let p = players.get(id);
    if (!p) {
      p = { fixtureId, playerId: id, teamId: `cs:${team}`, regulation: emptyPhase(), superOver: null, flags: [] };
      players.set(id, p);
      names.set(id, name);
    }
    return p;
  };
  /** Players in `info.players` and on deliveries must have a registry id: without one nothing can be linked or stored. */
  const ensure = (name: string, team: string, role: string): PlayerMatchStats =>
    ensureId(registryId(name) ?? fail(`${role} "${name}" has no info.registry.people id`), name, team);
  const phaseStats = (p: PlayerMatchStats, phase: 'regulation' | 'super_over'): PhaseStats =>
    phase === 'regulation' ? p.regulation : (p.superOver ??= emptyPhase());
  const batting = (p: PlayerMatchStats, phase: 'regulation' | 'super_over'): BattingStats => {
    const s = phaseStats(p, phase);
    return (s.batting ??= emptyBatting());
  };
  const flag = (code: FlagCode, detail: string, playerId: string): void => {
    const f: DataFlag = { code, fixtureId, playerId, detail };
    flags.push(f);
    players.get(playerId)?.flags.push(f);
  };

  // 1. Every listed player, on his team (impact substitutes are listed from 2023).
  for (const team of [team1, team2]) for (const name of info.players[team] ?? []) ensure(name, team, 'info.players entry');

  // 2. Deliveries, in file order (flags are reported in that order; the sums do not depend on it).
  const tallies = new Map<string, { bowler: PlayerMatchStats; phase: 'regulation' | 'super_over'; t: BowlingTally }>();
  innings.forEach((inn, i) => {
    if (inn.team !== team1 && inn.team !== team2) fail(`innings ${i + 1} team "${inn.team}" is not in info.teams`);
    const phase = inn.super_over === true ? 'super_over' : 'regulation';
    const battingTeam = inn.team;
    const fieldingTeam = otherTeam(inn.team);
    for (const ov of inn.overs) {
      ov.deliveries.forEach((d: Delivery, j) => {
        const where = `innings ${i + 1}${phase === 'super_over' ? ' (Super Over)' : ''} over ${ov.over} delivery ${j + 1}`;
        const striker = ensure(d.batter, battingTeam, 'batter');
        const nonStriker = ensure(d.non_striker, battingTeam, 'non-striker');
        const bowler = ensure(d.bowler, fieldingTeam, 'bowler');

        // FIELD_MAP §6.2: a wide or no-ball is any delivery with that extras key; Cricsheet `wides` already
        // includes runs run on a wide (charged to the bowler, as Sportmonks); byes, leg-byes and penalty are not.
        const wides = d.extras?.wides;
        const noballs = d.extras?.noballs;
        const legal = wides === undefined && noballs === undefined;
        const conceded = d.runs.batter + (wides ?? 0) + (noballs ?? 0);
        const boundary = d.runs.non_boundary !== true;

        const bat = batting(striker, phase);
        bat.runs += d.runs.batter;
        if (wides === undefined) bat.ballsFaced += 1; // balls faced exclude wides, include no-balls
        if (boundary && d.runs.batter === 4) bat.fours += 1;
        if (boundary && d.runs.batter === 6) bat.sixes += 1;
        batting(nonStriker, phase); // at the crease: a batting record even with no ball faced (as on a scorecard)

        const key = `${phase}|${bowler.playerId}`;
        let entry = tallies.get(key);
        if (!entry) {
          entry = {
            bowler,
            phase,
            t: { legalBalls: 0, runsConceded: 0, wickets: 0, dots: 0, wideDeliveries: 0, noBallDeliveries: 0, overs: new Map() },
          };
          tallies.set(key, entry);
        }
        const t = entry.t;
        t.runsConceded += conceded;
        if (legal) t.legalBalls += 1;
        if (legal && d.runs.total === 0) t.dots += 1; // a dot: legal and no team runs (byes, leg-byes, penalty spoil it)
        if (wides !== undefined) t.wideDeliveries += 1;
        if (noballs !== undefined) t.noBallDeliveries += 1;
        const overKey = `${i}|${ov.over}`;
        const o = t.overs.get(overKey) ?? { legal: 0, conceded: 0 };
        o.legal += legal ? 1 : 0;
        o.conceded += conceded;
        t.overs.set(overKey, o);

        for (const w of d.wickets ?? []) {
          const out = ensure(w.player_out, battingTeam, 'dismissed batter');
          const outBat = batting(out, phase);
          const what = `${where}: ${w.kind} of ${w.player_out}`;
          const fielders = (w.fielders ?? []).map((f) => ({
            name: f.name,
            sub: f.substitute === true,
            id: f.name === undefined ? null : registryId(f.name),
          }));
          // A named fielder with a registry id has a record (a substitute is not in info.players), on the fielding team.
          for (const f of fielders) if (f.id !== null) ensureId(f.id, f.name!, fieldingTeam);
          for (const f of fielders) {
            if (f.id !== null) continue;
            const who = f.name === undefined ? 'not named' : `"${f.name}" has no registry id`;
            if (f.sub) flag('sub_fielder_unidentified', `${what}; substitute fielder ${who}; substitute not credited`, out.playerId);
            else flag('unparseable_record', `${what}; fielder ${who}; no fielding credit`, out.playerId);
          }

          let kind = DISMISSAL_BY_KIND.get(w.kind) ?? null;
          if (kind === null) {
            flag('unknown_dismissal', `${what}; wicket kind "${w.kind}" has no DismissalKind; dismissal set to null`, out.playerId);
            continue;
          }
          if (kind === 'caught' && fielders.length === 1 && fielders[0]!.id !== null && fielders[0]!.id === bowler.playerId) {
            kind = 'caught_and_bowled';
          }
          // The last wicket event for a batter in a phase is his dismissal.
          outBat.dismissal = kind;
          if (BOWLER_CREDITED.has(kind)) t.wickets += 1;

          const credit = (p: PlayerMatchStats, stat: keyof FieldingStats): void => {
            phaseStats(p, phase).fielding[stat] += 1;
          };
          if (kind === 'caught_and_bowled') {
            credit(bowler, 'catches'); // spec §5.4: caught and bowled earns the bowler the catch too
          } else if (kind === 'caught' || kind === 'stumped') {
            if (fielders.length === 1) {
              const id = fielders[0]!.id;
              if (id !== null) credit(players.get(id)!, kind === 'stumped' ? 'stumpings' : 'catches');
            } else {
              // Same ruling as Sportmonks (Task 7 R5): FlagCode has no "fielder missing" code; unparseable_record
              // is the least-wrong one. The batting and the bowler's wicket still count.
              flag('unparseable_record', `${what} with ${fielders.length} fielders named; no fielding credit`, out.playerId);
            }
          } else if (kind === 'run_out') {
            const credited = creditedRunOutFielder(fielders.map((f) => f.id));
            if (credited !== null) credit(players.get(credited)!, 'runOuts');
            else {
              const named = fielders.map((f) => `${f.name ?? '(unnamed)'}${f.sub ? ' (substitute)' : ''}`).join(', ');
              flag(
                'runout_fielder_missing',
                `${what}; Cricsheet names ${named || 'no fielder'}; not credited (Cricsheet has no runout_by equivalent and its fielder order is unreliable; Task 12 ruling)`,
                out.playerId,
              );
            }
          }
        }
      });
    }
  });

  // 3. Bowling per bowler per phase (all from ball-by-ball: dots, maidens, wides and no-balls are always known).
  for (const { bowler, phase, t } of tallies.values()) {
    phaseStats(bowler, phase).bowling = {
      legalBalls: t.legalBalls,
      runsConceded: t.runsConceded,
      wickets: t.wickets,
      dots: t.dots,
      // Spec §5.4: six legal balls by that bowler in the over with nothing charged to him (>= as Sportmonks).
      maidens: [...t.overs.values()].filter((o) => o.legal >= 6 && o.conceded === 0).length,
      wideDeliveries: t.wideDeliveries,
      noBallDeliveries: t.noBallDeliveries,
    };
  }

  const sorted = [...players.values()].sort((a, b) => cmp(a.playerId, b.playerId));
  return {
    meta: {
      fixtureId,
      leagueId: 'cs:ipl',
      seasonId: `cs:${date.slice(0, 4)}`,
      // Cricsheet has no start time, only the date: UTC midnight of that date.
      startingAt: `${date}T00:00:00.000Z`,
      status: info.outcome?.result === 'no result' ? 'No result' : 'Finished',
      round: info.event?.stage ?? (info.event?.match_number === undefined ? null : `Match ${info.event.match_number}`),
      // Cricsheet has no home/away: the first listed team is "local".
      localTeamId: `cs:${team1}`,
      visitorTeamId: `cs:${team2}`,
      superOver: innings.some((inn) => inn.super_over === true),
      hasBallByBall: innings.some((inn) => inn.overs.some((ov) => ov.deliveries.length > 0)),
    },
    players: sorted,
    flags,
    playerNames: Object.fromEntries(sorted.map((p) => [p.playerId, names.get(p.playerId)!])),
  };
}
