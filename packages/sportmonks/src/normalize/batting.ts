import type { DataFlag, DismissalKind, FieldingStats, FlagCode, PhaseStats, PlayerMatchStats } from '@fc/scoring';
import {
  dismissalKindFromScoreName,
  isSubstituteDismissal,
  phaseOfScoreboard,
  runOutCreditedFielder,
  type ScoreCatalog,
} from '../fieldMap.js';
import {
  BattingRecordSchema,
  FixtureRosterSchema,
  LineupEntrySchema,
  issueSummary,
  parseFixtureData,
  type BattingRecord,
} from '../schema.js';

const emptyPhase = (): PhaseStats => ({
  batting: null,
  bowling: null,
  fielding: { catches: 0, stumpings: 0, runOuts: 0 },
});

/** `x[key]` as a string id when it is readable, for flagging a record that failed its schema. */
function readableId(x: unknown, key: string): string | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const v = (x as Record<string, unknown>)[key];
  return typeof v === 'number' || (typeof v === 'string' && v !== '') ? String(v) : undefined;
}

/**
 * Per-player batting and fielding for one fixture body (spec §5.1, §5.6; paths: FIELD_MAP §3–§5, §8).
 * Bowling is left null (Task 8). Throws only if the body is not a parseable `{ data: {...} }`.
 */
export function battingAndFielding(
  raw: unknown,
  catalog: ScoreCatalog,
): { players: Map<string, PlayerMatchStats>; flags: DataFlag[] } {
  const data = parseFixtureData(FixtureRosterSchema, raw);
  const fixtureId = String(data.id);
  const localTeamId = String(data.localteam_id);
  const visitorTeamId = String(data.visitorteam_id);
  const players = new Map<string, PlayerMatchStats>();
  const flags: DataFlag[] = [];

  /** The player's record, created with `teamId` if absent (an existing record keeps its team). */
  const ensure = (playerId: string, teamId: string): PlayerMatchStats => {
    let p = players.get(playerId);
    if (!p) {
      p = { fixtureId, playerId, teamId, regulation: emptyPhase(), superOver: null, flags: [] };
      players.set(playerId, p);
    }
    return p;
  };
  const phaseStats = (p: PlayerMatchStats, phase: 'regulation' | 'super_over'): PhaseStats =>
    phase === 'regulation' ? p.regulation : (p.superOver ??= emptyPhase());
  /** Records a flag; one about a player also goes on that player's record, if he has one. */
  const flag = (code: FlagCode, detail: string, playerId?: string): void => {
    const f: DataFlag = playerId === undefined ? { code, fixtureId, detail } : { code, fixtureId, playerId, detail };
    flags.push(f);
    if (playerId !== undefined) players.get(playerId)?.flags.push(f);
  };

  // 1. Every lineup player, on his lineup team.
  data.lineup.forEach((entry, i) => {
    const r = LineupEntrySchema.safeParse(entry);
    if (!r.success) {
      flag('unparseable_record', `lineup[${i}]: ${issueSummary(r.error)}; entry skipped`, readableId(entry, 'id'));
      return;
    }
    ensure(String(r.data.id), String(r.data.lineup.team_id));
  });

  // 2. Validate batting records; a batter missing from the lineup gets a record on his batting team.
  const records: BattingRecord[] = [];
  data.batting.forEach((entry, i) => {
    const r = BattingRecordSchema.safeParse(entry);
    if (!r.success) {
      flag('unparseable_record', `batting[${i}]: ${issueSummary(r.error)}; record skipped`, readableId(entry, 'player_id'));
      return;
    }
    const teamId = String(r.data.team_id);
    if (teamId !== localTeamId && teamId !== visitorTeamId) {
      flag('unparseable_record', `batting[${i}]: team_id ${teamId} is not a fixture team; record skipped`, String(r.data.player_id));
      return;
    }
    ensure(String(r.data.player_id), teamId);
    records.push(r.data);
  });

  // 3. Batting into its phase; fielding credit into the same phase.
  for (const rec of records) {
    const batterId = String(rec.player_id);
    const phase = phaseOfScoreboard(rec.scoreboard);
    const fieldingTeamId = String(rec.team_id) === localTeamId ? visitorTeamId : localTeamId;
    const where = `batter ${batterId} on ${rec.scoreboard}`;
    const name = rec.score_id === null ? undefined : catalog.get(String(rec.score_id))?.name;
    const kind = name === undefined ? null : dismissalKindFromScoreName(name);
    const fielderId = rec.catch_stump_player_id === null ? null : String(rec.catch_stump_player_id);
    const sub = name !== undefined && isSubstituteDismissal(name);

    let dismissal: DismissalKind | null = kind === 'not_out' ? null : kind;
    if (kind === null) {
      const why =
        rec.score_id === null
          ? 'score_id is null'
          : name === undefined
            ? `score_id ${rec.score_id} is not in the /scores catalog`
            : `score name "${name}" has no DismissalKind`;
      flag('unknown_dismissal', `${where}: ${why}; dismissal set to null`, batterId);
    }
    if (dismissal === 'caught' && fielderId !== null && rec.catch_stump_player_id === rec.bowling_player_id) {
      dismissal = 'caught_and_bowled';
    }

    const bat = phaseStats(players.get(batterId)!, phase);
    const prev = bat.batting;
    bat.batting = {
      runs: (prev?.runs ?? 0) + rec.score,
      ballsFaced: (prev?.ballsFaced ?? 0) + rec.ball,
      fours: (prev?.fours ?? 0) + rec.four_x,
      sixes: (prev?.sixes ?? 0) + rec.six_x,
      dismissal: dismissal ?? prev?.dismissal ?? null,
    };

    const credit = (playerId: string, stat: keyof FieldingStats): void => {
      phaseStats(ensure(playerId, fieldingTeamId), phase).fielding[stat] += 1;
    };
    if (sub && fielderId === null) {
      flag('sub_fielder_unidentified', `${where}: "${name}" with no catch_stump_player_id; substitute not credited`, batterId);
    }
    if (dismissal === 'caught' || dismissal === 'caught_and_bowled' || dismissal === 'stumped') {
      if (fielderId !== null) credit(fielderId, dismissal === 'stumped' ? 'stumpings' : 'catches');
      else if (!sub) {
        // FlagCode is a closed contract with no generic "fielder missing" code; unparseable_record is the
        // least-wrong existing one. The batting above is still counted; nobody gets fielding credit.
        flag('unparseable_record', `${where}: "${name}" caught/stumped with no fielder id; no fielding credit`, batterId);
      }
    } else if (dismissal === 'run_out') {
      const credited = runOutCreditedFielder(rec);
      if (credited !== null) credit(credited, 'runOuts');
      else {
        flag(
          'runout_fielder_missing',
          `${where}: run-out with runout_by_id null; catch_stump_player_id ${fielderId ?? 'none'} not credited`,
          batterId,
        );
      }
    }
  }

  return { players, flags };
}
