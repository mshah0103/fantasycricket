import type { DismissalKind } from '@fc/scoring';
import { ScoresBodySchema } from './schema.js';

// Sportmonks semantics taken from FIELD_MAP.md. Rules that need a commissioner decision live here
// so that changing them is a one-line edit.

/** Batting-record score names (FIELD_MAP §4). Names not listed are unknown and get `unknown_dismissal`. */
const DISMISSAL_BY_SCORE_NAME: ReadonlyMap<string, DismissalKind | 'not_out'> = new Map([
  ['Catch Out', 'caught'], // upgraded to caught_and_bowled by the normalizer when catcher === bowler
  ['Catch Out (Sub)', 'caught'],
  ['Clean Bowled', 'bowled'],
  ['Bowled', 'bowled'],
  ['LBW OUT', 'lbw'],
  ['Stump Out', 'stumped'],
  ['Stump Out (Sub)', 'stumped'],
  ['1 Wide + stump Out', 'stumped'],
  ['Hit Wicket', 'hit_wicket'],
  ['Run Out', 'run_out'],
  ['Run Out (Sub)', 'run_out'],
  ['Not Out', 'not_out'],
  ['Retired Hurt', 'retired_hurt'],
  ['Retired Out', 'retired_out'],
  ['Obstructing the Field Out', 'obstructing_field'],
  // Absent, Absent Hurt, Hit the ball twice: no DismissalKind -> unknown.
]);

/** `DismissalKind`, `'not_out'`, or `null` when the name is unknown. */
export function dismissalKindFromScoreName(name: string): DismissalKind | 'not_out' | null {
  return DISMISSAL_BY_SCORE_NAME.get(name) ?? null;
}

/** A substitute fielder was involved: the score name ends in `(Sub)` (FIELD_MAP §4, §5.3). */
export function isSubstituteDismissal(name: string): boolean {
  return name.endsWith('(Sub)');
}

/** `S1`/`S2` are regulation; `S<n>` with n >= 3 is a Super Over (FIELD_MAP §2.1). Throws on any other code. */
export function phaseOfScoreboard(code: string): 'regulation' | 'super_over' {
  const m = /^S([1-9]\d*)$/.exec(code);
  if (!m) throw new Error(`Unknown scoreboard code: ${JSON.stringify(code)}`);
  return Number(m[1]) <= 2 ? 'regulation' : 'super_over';
}

/** Score id -> score, built from the `/scores` catalog. */
export type ScoreCatalog = ReadonlyMap<string, { name: string }>;

/** Builds the catalog from a `/scores` response body; throws if the body is not `{ data: [{ id, name }] }`. */
export function buildScoreCatalog(scoresBody: unknown): ScoreCatalog {
  const parsed = ScoresBodySchema.safeParse(scoresBody);
  if (!parsed.success) throw new Error(`Unparseable /scores body: ${parsed.error.message}`);
  return new Map(parsed.data.data.map((s) => [String(s.id), { name: s.name }]));
}

/**
 * The fielder credited with a run-out, or null when the source names none (-> `runout_fielder_missing`).
 *
 * Spec §5.6, applied literally: the credited fielder is the `runoutby` relation, `runout_by_id`.
 * FIELD_MAP §5.2: `runout_by_id` is null on every single-fielder run-out (that fielder is only in
 * `catch_stump_player_id`) and on every run-out before 2021. The commissioner may rule that a lone
 * `catch_stump_player_id` counts; that is this one-line change:
 *   const id = rec.runout_by_id ?? rec.catch_stump_player_id;
 */
export function runOutCreditedFielder(rec: {
  runout_by_id: number | null;
  catch_stump_player_id: number | null;
}): string | null {
  const id = rec.runout_by_id;
  return id === null ? null : String(id);
}
