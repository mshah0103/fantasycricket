import { z } from 'zod';

// Zod schemas for the Sportmonks v2 fields the normalizer reads (paths and meanings: FIELD_MAP.md).
// Only the fields used are declared; `.passthrough()` keeps the rest. Ids are JSON numbers in the
// source and are converted with String() by the normalizer.

const Id = z.number().int();
const NullableId = Id.nullable();
const Count = z.number().int().nonnegative();
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
    balls: z.array(z.unknown()),
  })
  .passthrough();

/** `data` fields used for batting and fielding. Records are validated one by one (see below). */
export const FixtureRosterSchema = z
  .object({
    id: Id,
    localteam_id: Id,
    visitorteam_id: Id,
    lineup: z.array(z.unknown()),
    batting: z.array(z.unknown()),
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
    scoreboard: z.string().regex(/^S[1-9]\d*$/, 'expected scoreboard code S<n>'),
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

/** Parses a fixture body `{ data: {...} }` and returns `data`; throws if the envelope does not match. */
export function parseFixtureData<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = z.object({ data: schema }).safeParse(raw);
  if (!parsed.success) throw new Error(`Unparseable Sportmonks fixture body: ${parsed.error.message}`);
  return parsed.data.data;
}

/** One-line summary of a failed record parse, for flag details. */
export function issueSummary(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
