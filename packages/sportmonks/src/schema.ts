import { z } from 'zod';

// Zod schemas for the Sportmonks v2 fields the normalizer reads (paths and meanings: FIELD_MAP.md).
// Only the fields used are declared; `.passthrough()` keeps the rest. Ids are JSON numbers in the
// source and are converted with String() by the normalizer.

const Id = z.number().int();
const NullableId = Id.nullable();
const Count = z.number().int().nonnegative();
/** A collection key that may be absent (a washout has none, FIELD_MAP §1): missing key = empty array. */
const Collection = z.array(z.unknown()).default([]);
/** Innings code `S<n>`, n >= 1 (FIELD_MAP §2). */
const Scoreboard = z.string().regex(/^S[1-9]\d*$/, 'expected scoreboard code S<n>');
/** ISO 8601 with an explicit zone, so `new Date()` cannot fall back to local time. */
const IsoInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, 'expected ISO 8601 with a zone')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');

/** `/scores` catalog body: `{ data: [{ id, name, ... }] }` (FIELD_MAP §4). */
export const ScoresBodySchema = z
  .object({ data: z.array(z.object({ id: Id, name: z.string() }).passthrough()) })
  .passthrough();

/** `data` fields used for fixture metadata (FIELD_MAP §1). */
export const FixtureMetaSchema = z
  .object({
    id: Id,
    league_id: Id,
    season_id: Id,
    starting_at: IsoInstant,
    status: z.string(),
    round: z.string().nullish(),
    localteam_id: Id,
    visitorteam_id: Id,
    super_over: z.boolean().nullish(),
    balls: Collection,
  })
  .passthrough();

/** `data` fields used for batting and fielding. Records are validated one by one (see below). */
export const FixtureRosterSchema = z
  .object({
    id: Id,
    localteam_id: Id,
    visitorteam_id: Id,
    lineup: Collection,
    batting: Collection,
  })
  .passthrough();

/** `data.lineup[]`: a player resource with the `lineup` pivot (FIELD_MAP §8). */
export const LineupEntrySchema = z
  .object({ id: Id, lineup: z.object({ team_id: Id }).passthrough() })
  .passthrough();
export type LineupEntry = z.infer<typeof LineupEntrySchema>;

/** `data.batting[]` (FIELD_MAP §3). `scoreboard` must be `S<n>`, n >= 1 (FIELD_MAP §2). */
export const BattingRecordSchema = z
  .object({
    player_id: Id,
    team_id: Id,
    scoreboard: Scoreboard,
    score: Count,
    ball: Count,
    four_x: Count,
    six_x: Count,
    score_id: NullableId,
    catch_stump_player_id: NullableId,
    runout_by_id: NullableId,
    bowling_player_id: NullableId,
  })
  .passthrough();
export type BattingRecord = z.infer<typeof BattingRecordSchema>;

/** `data` fields used for bowling: balls, the bowling card and the innings list (FIELD_MAP §2, §6, §7). */
export const FixtureBowlingSchema = z
  .object({
    id: Id,
    localteam_id: Id,
    visitorteam_id: Id,
    super_over: z.boolean().nullish(),
    balls: Collection,
    bowling: Collection,
    runs: Collection,
  })
  .passthrough();

/** `data.balls[].score`: the embedded `/scores` catalog object (FIELD_MAP §6.2). `noball` is a 0/1 flag. */
const BallScoreSchema = z
  .object({
    id: Id,
    name: z.string(),
    runs: Count,
    bye: Count,
    leg_bye: Count,
    noball: z.number().int().min(0).max(1),
    ball: z.boolean(),
    is_wicket: z.boolean(),
  })
  .passthrough();

/** `data.balls[]` (FIELD_MAP §6.1). `team_id` is the batting team; `ball` is over index + legal ball / 10. */
export const BallRecordSchema = z
  .object({
    team_id: Id,
    scoreboard: Scoreboard,
    ball: z.number().nonnegative(),
    bowler_id: Id,
    score: BallScoreSchema,
  })
  .passthrough();
export type BallRecord = z.infer<typeof BallRecordSchema>;

/** `data.bowling[]` (FIELD_MAP §7). `team_id` is the bowling team; `overs` is `overs.balls`; `wide` is wide RUNS. */
export const BowlingRecordSchema = z
  .object({
    player_id: Id,
    team_id: Id,
    scoreboard: Scoreboard,
    overs: z
      .number()
      .nonnegative()
      .refine((o) => Math.round((o - Math.floor(o)) * 10) <= 5, 'expected overs.balls notation (balls 0-5)'),
    runs: Count,
    wickets: Count,
    wide: Count,
    noball: Count,
  })
  .passthrough();

/** `data.runs[]`: one entry per innings; `inning` N is scoreboard `S<N>` (FIELD_MAP §2.1). */
export const RunsEntrySchema = z.object({ inning: z.number().int().positive() }).passthrough();

/** Parses a fixture body `{ data: {...} }` and returns `data`; throws if the envelope does not match. */
export function parseFixtureData<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = z.object({ data: schema }).safeParse(raw);
  if (!parsed.success) throw new Error(`Unparseable Sportmonks fixture body: ${parsed.error.message}`);
  return parsed.data.data;
}

/** `x[key]` as a string id when it is readable, for flagging a record that failed its schema. */
export function readableId(x: unknown, key: string): string | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const v = (x as Record<string, unknown>)[key];
  return typeof v === 'number' || (typeof v === 'string' && v !== '') ? String(v) : undefined;
}

/** One-line summary of a failed record parse, for flag details. */
export function issueSummary(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
