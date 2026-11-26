import type { DataFlag, PlayerMatchStats } from '@fc/scoring';
import type { ScoreCatalog } from '../fieldMap.js';
import { battingAndFielding, emptyPhase } from './batting.js';
import { analyzeBowling } from './bowling.js';
import { fixtureMeta, type FixtureMeta } from './meta.js';

export interface NormalizedFixture {
  meta: FixtureMeta;
  players: PlayerMatchStats[];
  flags: DataFlag[];
}

/**
 * One fixture body -> one `PlayerMatchStats` per player (batting, fielding and bowling merged), sorted
 * by numeric player id so that rebuilds are byte-identical. `flags` holds every flag; a flag about a
 * player is also on that player's record when he has one. Throws only if the body is not a parseable
 * `{ data: {...} }`.
 */
export function normalizeFixture(raw: unknown, catalog: ScoreCatalog): NormalizedFixture {
  const meta = fixtureMeta(raw);
  const { players, flags: battingFlags } = battingAndFielding(raw, catalog);
  const bowling = analyzeBowling(raw);

  for (const [playerId, phases] of bowling.byPlayerPhase) {
    let p = players.get(playerId);
    if (!p) {
      // Not in the lineup and no batting or fielding: a record on his bowling team.
      const teamId = bowling.teamIds.get(playerId);
      if (teamId === undefined) throw new Error(`normalizeFixture: no bowling team for bowler ${playerId}`);
      p = { fixtureId: meta.fixtureId, playerId, teamId, regulation: emptyPhase(), superOver: null, flags: [] };
      players.set(playerId, p);
    }
    p.regulation.bowling = phases.regulation;
    if (phases.superOver) (p.superOver ??= emptyPhase()).bowling = phases.superOver;
  }
  for (const f of bowling.flags) {
    if (f.playerId !== undefined) players.get(f.playerId)?.flags.push(f);
  }

  return {
    meta,
    players: [...players.values()].sort((a, b) => Number(a.playerId) - Number(b.playerId)),
    flags: [...battingFlags, ...bowling.flags],
  };
}
