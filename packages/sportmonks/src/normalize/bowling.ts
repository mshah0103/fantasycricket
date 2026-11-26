import type { BowlingStats, DataFlag, DismissalKind, FlagCode } from '@fc/scoring';
import { dismissalKindFromScoreName, phaseOfScoreboard } from '../fieldMap.js';
import {
  BallRecordSchema,
  BowlingRecordSchema,
  FixtureBowlingSchema,
  RunsEntrySchema,
  issueSummary,
  parseFixtureData,
  readableId,
  type BallRecord,
} from '../schema.js';

type Phase = 'regulation' | 'super_over';

export interface BowlerPhases {
  regulation: BowlingStats | null;
  superOver: BowlingStats | null;
}

export interface BowlingAnalysis {
  /** Bowler id -> his bowling per phase. Only bowlers with bowling in at least one phase are listed. */
  byPlayerPhase: Map<string, BowlerPhases>;
  /** Bowling team of every bowler in `byPlayerPhase`: his card row's team, else the team not batting on his balls. */
  teamIds: Map<string, string>;
  flags: DataFlag[];
}

/** Dismissal kinds that credit the bowler with a wicket (spec §5.4). */
const BOWLER_CREDITED: ReadonlySet<DismissalKind> = new Set<DismissalKind>([
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'hit_wicket',
]);
/** Ball-only wicket names that `dismissalKindFromScoreName` does not cover (FIELD_MAP §6.3). */
const BALL_ONLY_KINDS: ReadonlyMap<string, DismissalKind> = new Map([['1 Wide + Hit Wicket', 'hit_wicket']]);
/** Catalog entries whose fields contradict their name (FIELD_MAP §11.12): flagged, never trusted. */
const INCONSISTENT_SCORE_IDS: ReadonlySet<number> = new Set([6, 25, 106]);

interface Delivery {
  wide: boolean;
  noBall: boolean;
  legal: boolean;
  /** Runs charged to the bowler. */
  conceded: number;
  dot: boolean;
  wicket: boolean;
}

/**
 * What one ball record means for its bowler (FIELD_MAP §6.2–§6.3). Returns null for a record that is
 * not a delivery (`score.ball` false and not a wide: penalty, absent, retired out), or a reason string
 * when the score cannot be trusted.
 */
function classify(s: BallRecord['score']): Delivery | null | string {
  if (INCONSISTENT_SCORE_IDS.has(s.id)) return `catalog score ${s.id} "${s.name}" is internally inconsistent (FIELD_MAP §11.12)`;
  const wide = s.ball === false && s.name.includes('Wide');
  if (s.ball === false && !wide) return null;
  const noBall = s.noball === 1;
  const legal = !wide && !noBall;
  // On a wide every run is a wide charged to the bowler (byes off a wide included); otherwise
  // `runs` holds batter runs plus the no-ball run, and byes/leg-byes are not in it.
  const conceded = wide ? s.runs + s.bye : s.runs;
  const teamRuns = s.runs + s.bye + s.leg_bye;
  let wicket = false;
  if (s.is_wicket && !s.name.includes('Run Out')) {
    const kind = dismissalKindFromScoreName(s.name) ?? BALL_ONLY_KINDS.get(s.name) ?? null;
    // An unknown name credits no wicket here; the batting record carries the unknown_dismissal flag
    // and a card that does credit it raises bowling_card_mismatch.
    wicket = kind !== null && kind !== 'not_out' && BOWLER_CREDITED.has(kind);
  }
  return { wide, noBall, legal, conceded, dot: legal && teamRuns === 0, wicket };
}

interface Tally {
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  dots: number;
  wideDeliveries: number;
  wideRuns: number;
  noBallDeliveries: number;
  /** `scoreboard|over index` -> this bowler's legal balls and conceded runs in that over. */
  overs: Map<string, { legal: number; conceded: number }>;
}

interface CardTotals {
  overs: number[];
  legalBalls: number;
  runs: number;
  wickets: number;
  wide: number;
  noball: number;
}

/** Card `overs` is `overs.balls`: 3.2 = 20 legal balls (FIELD_MAP §7). */
const cardLegalBalls = (overs: number): number => Math.floor(overs) * 6 + Math.round((overs - Math.floor(overs)) * 10);

const fromTally = (t: Tally): BowlingStats => ({
  legalBalls: t.legalBalls,
  runsConceded: t.runsConceded,
  wickets: t.wickets,
  dots: t.dots,
  maidens: [...t.overs.values()].filter((o) => o.legal >= 6 && o.conceded === 0).length,
  wideDeliveries: t.wideDeliveries,
  noBallDeliveries: t.noBallDeliveries,
});

/** Card fallback: what the card knows; per-delivery quantities are unknown (FIELD_MAP §7). */
const fromCard = (c: CardTotals): BowlingStats => ({
  legalBalls: c.legalBalls,
  runsConceded: c.runs,
  wickets: c.wickets,
  dots: null,
  maidens: null,
  wideDeliveries: null,
  noBallDeliveries: null,
});

/** A card row that records nothing (m44 Arshdeep: 0 overs, 0 runs) means "did not bowl". */
const cardIsEmpty = (c: CardTotals): boolean =>
  c.legalBalls === 0 && c.runs === 0 && c.wickets === 0 && c.wide === 0 && c.noball === 0;

/**
 * Per-bowler, per-phase bowling from ball-by-ball data, reconciled with the bowling card
 * (spec §5.4–§5.5, §5.8; FIELD_MAP §2, §6, §7, §11; controller rulings R7–R9).
 * Throws only if the body is not a parseable `{ data: {...} }`.
 */
export function analyzeBowling(raw: unknown): BowlingAnalysis {
  const data = parseFixtureData(FixtureBowlingSchema, raw);
  const fixtureId = String(data.id);
  const localTeamId = String(data.localteam_id);
  const visitorTeamId = String(data.visitorteam_id);
  const isFixtureTeam = (t: string): boolean => t === localTeamId || t === visitorTeamId;
  const flags: DataFlag[] = [];
  const flag = (code: FlagCode, detail: string, playerId?: string): void => {
    flags.push(playerId === undefined ? { code, fixtureId, detail } : { code, fixtureId, playerId, detail });
  };

  /** Every (bowler, phase) seen, in first-seen order: card rows first, then balls. */
  const keys = new Map<string, { bowlerId: string; phase: Phase }>();
  const noteKey = (bowlerId: string, phase: Phase): void => {
    const k = `${phase}|${bowlerId}`;
    if (!keys.has(k)) keys.set(k, { bowlerId, phase });
  };
  const scoreboardsOf = new Map<string, Set<string>>(); // `${phase}|${bowlerId}` -> scoreboard codes
  const noteScoreboard = (bowlerId: string, phase: Phase, scoreboard: string): void => {
    const k = `${phase}|${bowlerId}`;
    let s = scoreboardsOf.get(k);
    if (!s) scoreboardsOf.set(k, (s = new Set()));
    s.add(scoreboard);
  };
  const teamIds = new Map<string, string>();

  // 1. Bowling card, summed per bowler per phase.
  const card = new Map<string, CardTotals>();
  data.bowling.forEach((entry, i) => {
    const r = BowlingRecordSchema.safeParse(entry);
    if (!r.success) {
      flag('unparseable_record', `bowling[${i}]: ${issueSummary(r.error)}; card row skipped`, readableId(entry, 'player_id'));
      return;
    }
    const row = r.data;
    const bowlerId = String(row.player_id);
    const teamId = String(row.team_id);
    if (!isFixtureTeam(teamId)) {
      flag('unparseable_record', `bowling[${i}]: team_id ${teamId} is not a fixture team; card row skipped`, bowlerId);
      return;
    }
    const phase = phaseOfScoreboard(row.scoreboard);
    noteKey(bowlerId, phase);
    noteScoreboard(bowlerId, phase, row.scoreboard);
    if (!teamIds.has(bowlerId)) teamIds.set(bowlerId, teamId);
    const k = `${phase}|${bowlerId}`;
    const c = card.get(k) ?? { overs: [], legalBalls: 0, runs: 0, wickets: 0, wide: 0, noball: 0 };
    c.overs.push(row.overs);
    c.legalBalls += cardLegalBalls(row.overs);
    c.runs += row.runs;
    c.wickets += row.wickets;
    c.wide += row.wide;
    c.noball += row.noball;
    card.set(k, c);
  });
  const hasCard = card.size > 0;

  // 2. Balls, tallied per bowler per phase. Order-independent (FIELD_MAP §6.1).
  const tallies = new Map<string, Tally>();
  const ballScoreboards = new Set<string>();
  data.balls.forEach((entry, i) => {
    const r = BallRecordSchema.safeParse(entry);
    if (!r.success) {
      flag('unparseable_record', `balls[${i}]: ${issueSummary(r.error)}; ball skipped`, readableId(entry, 'bowler_id'));
      return;
    }
    const b = r.data;
    const bowlerId = String(b.bowler_id);
    const where = `balls[${i}] (${b.scoreboard} ${b.ball})`;
    ballScoreboards.add(b.scoreboard);
    const battingTeamId = String(b.team_id);
    if (!isFixtureTeam(battingTeamId)) {
      flag('unparseable_record', `${where}: team_id ${battingTeamId} is not a fixture team; ball skipped`, bowlerId);
      return;
    }
    const d = classify(b.score);
    if (d === null) return;
    if (typeof d === 'string') {
      flag('unparseable_record', `${where}: ${d}; ball skipped`, bowlerId);
      return;
    }
    const phase = phaseOfScoreboard(b.scoreboard);
    noteKey(bowlerId, phase);
    noteScoreboard(bowlerId, phase, b.scoreboard);
    if (!teamIds.has(bowlerId)) teamIds.set(bowlerId, battingTeamId === localTeamId ? visitorTeamId : localTeamId);
    const k = `${phase}|${bowlerId}`;
    let t = tallies.get(k);
    if (!t) {
      t = { legalBalls: 0, runsConceded: 0, wickets: 0, dots: 0, wideDeliveries: 0, wideRuns: 0, noBallDeliveries: 0, overs: new Map() };
      tallies.set(k, t);
    }
    t.runsConceded += d.conceded;
    if (d.legal) t.legalBalls += 1;
    if (d.dot) t.dots += 1;
    if (d.wicket) t.wickets += 1;
    if (d.wide) {
      t.wideDeliveries += 1;
      t.wideRuns += d.conceded;
    }
    if (d.noBall) t.noBallDeliveries += 1;
    const overKey = `${b.scoreboard}|${Math.floor(b.ball)}`;
    const o = t.overs.get(overKey) ?? { legal: 0, conceded: 0 };
    o.legal += d.legal ? 1 : 0;
    o.conceded += d.conceded;
    t.overs.set(overKey, o);
  });

  // 3. Reconcile each bowler's phase: balls win; the card fills a gap; disagreements are flagged.
  const byPlayerPhase = new Map<string, BowlerPhases>();
  for (const [k, { bowlerId, phase }] of keys) {
    const t = tallies.get(k);
    const c = card.get(k);
    const where = `bowler ${bowlerId} ${phase} (${[...(scoreboardsOf.get(k) ?? [])].join(', ')})`;
    const cardText = c
      ? `card {overs ${c.overs.join('+')} (${c.legalBalls} legal), runs ${c.runs}, wickets ${c.wickets}, wide runs ${c.wide}, no-balls ${c.noball}}`
      : '';
    let stats: BowlingStats | null = null;
    if (!t) {
      if (c && !cardIsEmpty(c)) {
        stats = fromCard(c);
        const why =
          data.balls.length === 0
            ? 'the fixture has no ball-by-ball data'
            : `no ball records for this bowler in this phase (the fixture has ${data.balls.length} ball records)`;
        flag('ball_data_missing', `${where}: ${why}; ${cardText} used; dots, maidens, wides and no-balls unknown`, bowlerId);
      }
    } else {
      stats = fromTally(t);
      const ballText = `balls {legal ${t.legalBalls}, runs ${t.runsConceded}, wickets ${t.wickets}, wide runs ${t.wideRuns}, no-balls ${t.noBallDeliveries}}`;
      if (!c) {
        if (hasCard) flag('bowling_card_mismatch', `${where}: ${ballText} but no card row; ball-derived values kept`, bowlerId);
      } else if (
        t.legalBalls !== c.legalBalls ||
        t.runsConceded !== c.runs ||
        t.wickets !== c.wickets ||
        t.wideRuns !== c.wide ||
        t.noBallDeliveries !== c.noball
      ) {
        flag('bowling_card_mismatch', `${where}: ${ballText} vs ${cardText}; ball-derived values kept`, bowlerId);
      }
    }
    if (stats === null) continue;
    const entry = byPlayerPhase.get(bowlerId) ?? { regulation: null, superOver: null };
    if (phase === 'regulation') entry.regulation = stats;
    else entry.superOver = stats;
    byPlayerPhase.set(bowlerId, entry);
  }

  // 4. Super Over innings in runs[] with no ball records (FIELD_MAP §2.2, ruling R9): one fixture-level flag.
  if (data.super_over === true) {
    const missing: number[] = [];
    data.runs.forEach((entry, i) => {
      const r = RunsEntrySchema.safeParse(entry);
      if (!r.success) {
        flag('unparseable_record', `runs[${i}]: ${issueSummary(r.error)}; innings entry skipped`);
        return;
      }
      const inning = r.data.inning;
      if (inning >= 3 && !ballScoreboards.has(`S${inning}`) && !missing.includes(inning)) missing.push(inning);
    });
    if (missing.length > 0) {
      missing.sort((a, b) => a - b);
      flag(
        'ball_data_missing',
        `Super Over innings ${missing.join(', ')} in runs[] have no ball records (${missing.map((n) => `S${n}`).join(', ')}); Super Over ball-by-ball detail is missing`,
      );
    }
  }

  for (const id of [...teamIds.keys()]) if (!byPlayerPhase.has(id)) teamIds.delete(id);
  return { byPlayerPhase, teamIds, flags };
}

/** Per-bowler, per-phase bowling (see `analyzeBowling`), without the bowling-team lookup. */
export function bowlingFromBalls(raw: unknown): {
  byPlayerPhase: Map<string, { regulation: BowlingStats | null; superOver: BowlingStats | null }>;
  flags: DataFlag[];
} {
  const { byPlayerPhase, flags } = analyzeBowling(raw);
  return { byPlayerPhase, flags };
}
