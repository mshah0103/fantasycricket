import { scorePlayerMatch, type ScoreResult } from '@fc/scoring';
import type { ScoreCatalog } from './fieldMap.js';
import { normalizeFixture } from './normalize/index.js';
import { readRecording } from './record.js';

/** Re-scores a recording snapshot by snapshot: playerId -> score at each point in time. */
export async function* replayScores(
  dir: string,
  catalog: ScoreCatalog,
): AsyncIterable<{ seq: number; fetchedAt: string; scores: Map<string, ScoreResult> }> {
  for await (const snap of readRecording(dir)) {
    const scores = new Map<string, ScoreResult>();
    for (const p of normalizeFixture(snap.body, catalog).players) scores.set(p.playerId, scorePlayerMatch(p));
    yield { seq: snap.seq, fetchedAt: snap.fetchedAt, scores };
  }
}
