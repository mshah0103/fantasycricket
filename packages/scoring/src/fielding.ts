import type { FieldingStats, HalfPoints, ScoreComponent } from './types.js';
import { hp } from './points.js';

export function scoreFielding(f: FieldingStats, phase: 'regulation' | 'super_over'): ScoreComponent[] {
  const out: ScoreComponent[] = [];
  const add = (code: ScoreComponent['code'], quantity: number, halfPoints: HalfPoints) => {
    if (halfPoints !== 0) out.push({ phase, code, quantity, halfPoints });
  };

  add('field_catches', f.catches, f.catches * hp(4));
  add('field_stumpings', f.stumpings, f.stumpings * hp(8));
  add('field_runouts', f.runOuts, f.runOuts * hp(8));
  return out;
}
