import type { PhaseStats, PlayerMatchStats, ScoreComponent, ScoreResult } from './types.js';
import { RULES_VERSION } from './points.js';
import { scoreBatting } from './batting.js';
import { scoreBowling } from './bowling.js';
import { scoreFielding } from './fielding.js';

function scorePhase(p: PhaseStats, phase: 'regulation' | 'super_over'): ScoreComponent[] {
  return [
    ...(p.batting ? scoreBatting(p.batting, phase) : []),
    ...(p.bowling ? scoreBowling(p.bowling, phase) : []),
    ...scoreFielding(p.fielding, phase),
  ];
}

export function scorePlayerMatch(stats: PlayerMatchStats): ScoreResult {
  const components = [
    ...scorePhase(stats.regulation, 'regulation'),
    ...(stats.superOver ? scorePhase(stats.superOver, 'super_over') : []),
  ];
  return {
    rulesVersion: RULES_VERSION,
    totalHalfPoints: components.reduce((sum, c) => sum + c.halfPoints, 0),
    components,
    flags: [...stats.flags],
  };
}
