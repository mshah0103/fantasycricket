# Cricket Fantasy MVP — Plan 1 of 6: M0 Data Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript monorepo containing:
- a tested `t20-v0.7` scoring engine
- a Sportmonks client that archives every response
- a normalizer that turns Sportmonks fixtures into scored player-match records
- a full IPL history pull with a coverage report
- a live-match recorder with replay
- the Sportmonks verification report that later plans depend on

**Architecture:** A pnpm workspace with two packages in M0.
- `@fc/scoring` is pure: no I/O, integer half-points.
- `@fc/sportmonks` holds the HTTP client, the raw archive, the normalizer, and the CLIs.

M0 has no database. Raw responses, recordings, and derived history are files under `data/` (git-ignored). M1 loads them into Postgres.

**Tech Stack:** Node.js ≥ 22 LTS, TypeScript 5 (strict, ESM), pnpm ≥ 10 workspaces, Vitest, tsx (for CLIs), zod (to parse raw responses).

**Spec:** `docs/superpowers/specs/2026-11-21-cricket-fantasy-mvp-design.md` (approved 2026-11-23). Sections cited as "spec §n".

**This is plan 1 of 6, one per milestone (M0–M5).** Plans 2–6 will be written after this plan's verification report (Task 11), because gate results can change adapter details (spec §12.3).

**Order and timing:**
- Tasks 1–5 and 7–9 need no network access to Sportmonks.
- Steps marked 🌐 need a machine that can reach `cricket.sportmonks.com` with `SPORTMONKS_API_TOKEN` set. Use the commissioner's Mac or the Unraid server. The cloud workspace's network blocks that host.
- Task 10's recordings need live Big Bash matches (mid-December onward).
- Task 11's gate 8 needs IPL 2027 squads (after the 16 December 2026 auction).

## Global Constraints

- The rules version string is exactly `t20-v0.7` (spec header).
- Points are integer half-points (1 = 0.5 points), never binary floats (spec §14).
- Rate bands compare exact values with integer cross-multiplication and no rounding. For strike rate, `100 × runs` vs `threshold × balls`. For economy, `6 × runs` vs `threshold × legalBalls` (spec §5).
- Missing or unparseable source data produces a `DataFlag`. Never infer a fielder, and never silently score zero (spec §2 anti-goals, §5.6).
- Every Sportmonks response is archived raw before any code uses it (spec §3, §11).
- Sportmonks base URL is `https://cricket.sportmonks.com/api/v2.0`, with the token in the `api_token` query parameter, read from env `SPORTMONKS_API_TOKEN`. The token is never committed, never written to an archive, and never included in logs or errors.
- The client enforces at most 1,500 calls per hour per endpoint path, under Sportmonks' 2,000 limit (spec §3).
- All stored times are UTC ISO 8601 strings.
- `data/` is git-ignored. Sportmonks fixtures exported for tests live in `packages/sportmonks/test/fixtures/` and are committed (the repo is private).
- The data root is env `FC_DATA_DIR`, defaulting to `./data` at the repo root.

## Review Focus

1. **A player who batted only in a Super Over.** He gets Super Over events only: no duck, no strike rate. Test in Task 4.
2. **A bowler with zero legal balls** (only wides or no-balls). Per-delivery penalties apply, there is no economy component, and no division by zero. Test in Task 3.
3. **A substitute fielder who is not in either lineup.** He still gets a `PlayerMatchStats` record with his catch or run-out, assigned to the fielding team. Test in Task 7.
4. **A fixture with partial or no play** (abandoned after one innings, or a washout). The normalizer returns what was played, with no throw, and the status is captured. Tests in Tasks 7 and 9.
5. **Shape drift in a Sportmonks response** (a record missing a field or with an unexpected null). That record gets an `unparseable_record` flag, and the rest of the fixture still normalizes. Test in Task 7.

---

## File Structure

```
package.json                     root scripts: test, typecheck
pnpm-workspace.yaml              packages/*
tsconfig.base.json               strict, ESM, NodeNext
vitest.config.ts                 projects: packages/*
.gitignore                       node_modules, data/, .env
.nvmrc                           22
docs/superpowers/specs/…         approved spec (copied in)
docs/superpowers/plans/…         this plan
docs/sportmonks-verification.md  produced by Task 11

packages/scoring/
  src/types.ts      stat model + score result contract
  src/points.ts     half-point helpers, RULES_VERSION
  src/bands.ts      band tables + exact band lookup
  src/batting.ts    scoreBatting
  src/bowling.ts    scoreBowling
  src/fielding.ts   scoreFielding
  src/score.ts      scorePlayerMatch
  src/index.ts      public exports
  test/*.test.ts

packages/sportmonks/
  FIELD_MAP.md      real field names/values observed (Task 6)
  src/config.ts     env reading
  src/archive.ts    gzip JSON archive + manifest
  src/rateLimit.ts  per-endpoint hourly limiter
  src/client.ts     HTTP client
  src/endpoints.ts  endpoint paths + FIXTURE_INCLUDES
  src/discover.ts   IPL league/season/fixture discovery
  src/pull.ts       resumable raw history pull
  src/schema.ts     zod schemas for fields the normalizer uses
  src/fieldMap.ts   dismissal names, scoreboard phases, ball semantics
  src/normalize/meta.ts      FixtureMeta
  src/normalize/batting.ts   batting + fielding → PlayerMatchStats
  src/normalize/bowling.ts   ball-by-ball bowling + card reconciliation
  src/normalize/index.ts     normalizeFixture
  src/history.ts    archive → scored JSONL + coverage
  src/record.ts     live recorder + poll schedule
  src/replay.ts     recording reader + replay scoring
  src/gates.ts      verification report generator
  src/cli/*.ts      thin CLIs over the modules above
  test/*.test.ts
  test/fixtures/*.json   exported real fixtures (Task 6)
```

---

## Phase A: Scoring engine (no network needed)

### Task 1: Workspace and scoring contract

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `README.md`
- Create: `docs/superpowers/specs/2026-11-21-cricket-fantasy-mvp-design.md` (copy of the approved spec), `docs/superpowers/plans/2026-11-23-m0-data-foundation.md` (this plan)
- Create: `packages/scoring/package.json` (`"name": "@fc/scoring"`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`), `packages/scoring/tsconfig.json`, `packages/scoring/src/types.ts`, `packages/scoring/src/points.ts`, `packages/scoring/src/index.ts`
- Test: `packages/scoring/test/points.test.ts`

**Interfaces:**
- Produces, in `src/types.ts` (the contract every later task uses; copy exactly):

```ts
export type HalfPoints = number; // integer; 1 = 0.5 fantasy points

export type DismissalKind =
  | 'bowled' | 'caught' | 'caught_and_bowled' | 'lbw' | 'stumped' | 'hit_wicket'
  | 'run_out' | 'retired_hurt' | 'retired_out' | 'obstructing_field' | 'timed_out' | 'handled_ball';

export interface BattingStats {
  runs: number;
  ballsFaced: number;            // excludes wides, includes no-balls faced
  fours: number;                 // boundary fours only
  sixes: number;
  dismissal: DismissalKind | null; // null = not out (or unknown, flagged)
}

export interface BowlingStats {
  legalBalls: number;
  runsConceded: number;          // batter runs + wides + no-balls; excludes byes/leg-byes
  wickets: number;               // bowler-credited only
  dots: number | null;           // null = unknown (no ball-by-ball)
  maidens: number | null;
  wideDeliveries: number | null;
  noBallDeliveries: number | null;
}

export interface FieldingStats { catches: number; stumpings: number; runOuts: number; }

export interface PhaseStats {
  batting: BattingStats | null;  // null = did not bat in this phase
  bowling: BowlingStats | null;  // null = did not bowl in this phase
  fielding: FieldingStats;
}

export type FlagCode =
  | 'runout_fielder_missing' | 'sub_fielder_unidentified' | 'unknown_dismissal'
  | 'ball_data_missing' | 'bowling_card_mismatch' | 'unparseable_record';

export interface DataFlag { code: FlagCode; fixtureId: string; playerId?: string; detail: string; }

export interface PlayerMatchStats {
  fixtureId: string;             // Sportmonks fixture id, as string
  playerId: string;              // Sportmonks player id, as string
  teamId: string;
  regulation: PhaseStats;
  superOver: PhaseStats | null;  // all Super Overs aggregated; null = none
  flags: DataFlag[];
}

export type ComponentCode =
  | 'bat_runs' | 'bat_fours' | 'bat_sixes' | 'bat_duck' | 'bat_milestone' | 'bat_strike_rate'
  | 'bowl_wickets' | 'bowl_milestone' | 'bowl_dots' | 'bowl_maidens' | 'bowl_wides'
  | 'bowl_noballs' | 'bowl_economy'
  | 'field_catches' | 'field_stumpings' | 'field_runouts';

export interface ScoreComponent {
  phase: 'regulation' | 'super_over';
  code: ComponentCode;
  quantity: number;   // the count scored (runs, dots…); for rates, the rate rounded to 2 dp for display only
  halfPoints: HalfPoints;
}

export interface ScoreResult {
  rulesVersion: 't20-v0.7';
  totalHalfPoints: HalfPoints;
  components: ScoreComponent[];  // zero-value components omitted
  flags: DataFlag[];             // passed through from input
}
```

- Produces, in `src/points.ts`: `RULES_VERSION = 't20-v0.7'`, `hp(points: number): HalfPoints` (throws `RangeError` unless `points × 2` is an integer), `toPoints(h: HalfPoints): number`, `formatPoints(h: HalfPoints): string` (one decimal place).

- [ ] **Step 1: Create the workspace files.** Use pnpm workspaces over `packages/*`. Root scripts: `"test": "vitest run"` and `"typecheck": "pnpm -r exec tsc --noEmit"`. `vitest.config.ts` uses `test.projects: ['packages/*']`. `.gitignore` covers `node_modules`, `data/`, and `.env*`. Copy in the spec and this plan. Run `git init`.

- [ ] **Step 2: Write the failing test** `packages/scoring/test/points.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { hp, toPoints, formatPoints, RULES_VERSION } from '../src/index.js';

describe('points', () => {
  it('converts to half-points and back', () => {
    expect(hp(92.5)).toBe(185);
    expect(hp(-3)).toBe(-6);
    expect(toPoints(185)).toBe(92.5);
  });
  it('rejects values that are not multiples of 0.5', () => {
    expect(() => hp(0.3)).toThrow(RangeError);
  });
  it('formats with one decimal', () => {
    expect(formatPoints(185)).toBe('92.5');
    expect(formatPoints(-6)).toBe('-3.0');
  });
  it('exposes the rules version', () => {
    expect(RULES_VERSION).toBe('t20-v0.7');
  });
});
```

- [ ] **Step 3: Run it to confirm it fails.** Run `pnpm install && pnpm test`. Expected: FAIL, cannot resolve `../src/index.js`.
- [ ] **Step 4: Implement `types.ts`, `points.ts`, and `index.ts`.** `index.ts` re-exports both.
- [ ] **Step 5: Run the tests and typecheck.** Run `pnpm test && pnpm typecheck`. Expected: 4 passed, no type errors.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "chore: scaffold workspace and scoring contract"`

---

### Task 2: Batting scoring

**Files:**
- Create: `packages/scoring/src/bands.ts`, `packages/scoring/src/batting.ts`
- Test: `packages/scoring/test/batting.test.ts`

**Interfaces:**
- Consumes: the types from Task 1 and `hp`.
- Produces:
  - `strikeRateHalfPoints(runs: number, balls: number): HalfPoints | null`, which returns `null` when `balls < 10`.
  - `scoreBatting(b: BattingStats, phase: 'regulation' | 'super_over'): ScoreComponent[]`.
  - From `bands.ts`: `bandHalfPoints(numerator: number, denominator: number, scale: number, thresholds: readonly number[], points: readonly number[]): HalfPoints`. This is the exact lookup: find the first `i` with `scale × numerator < thresholds[i] × denominator`, and return `hp(points[i])`, or `hp(points[last])` if there is none.
  - Exported constants `SR_THRESHOLDS = [60,80,100,120,140,160,180,220,260,300]` with `SR_POINTS = [-5,-3,-1,0,1,2,3,4,5,6,7]`, and `ECON_THRESHOLDS = [4,5,6,7,8,9,10,11,13,15]` with `ECON_POINTS = [7,5,4,3,2,1,0,-1,-3,-5,-7]`.

The rules (spec §5.1–5.3):

- **Event points:** runs +0.5, fours +1, sixes +1.5.
- **Duck (regulation only):** −3 when `runs === 0` and `dismissal` is not `null` and not `'retired_hurt'`.
- **Milestone (regulation only, highest one):** 10→+1, 25→+2, 50→+3, 75→+5, 100→+8, 150→+10.
- **Strike rate (regulation only):** applies only when `balls ≥ 10`.
- **Super Over phase:** event points only.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { scoreBatting, strikeRateHalfPoints } from '../src/batting.js';

const sum = (cs: { halfPoints: number }[]) => cs.reduce((s, c) => s + c.halfPoints, 0);
const bat = (runs: number, ballsFaced: number, fours = 0, sixes = 0, dismissal: any = 'caught') =>
  ({ runs, ballsFaced, fours, sixes, dismissal });

describe('scoreBatting', () => {
  it('scores Marsh 117 off 64 (10x4, 8x6) as 92.5', () => {
    const cs = scoreBatting(bat(117, 64, 10, 8), 'regulation');
    expect(sum(cs)).toBe(185);
    expect(cs.find(c => c.code === 'bat_milestone')?.halfPoints).toBe(16);
    expect(cs.find(c => c.code === 'bat_strike_rate')?.halfPoints).toBe(8);
  });
  it('applies milestone bands', () => {
    const m = (r: number) => scoreBatting(bat(r, 200), 'regulation')
      .find(c => c.code === 'bat_milestone')?.halfPoints ?? 0;
    expect([9,10,24,25,49,50,74,75,99,100,149,150].map(m))
      .toEqual([0,2,2,4,4,6,6,10,10,16,16,20]);
  });
  it('uses exact strike-rate boundaries', () => {
    expect(strikeRateHalfPoints(22, 10)).toBe(10);  // 220 -> +5
    expect(strikeRateHalfPoints(21, 10)).toBe(8);   // 210 -> +4
    expect(strikeRateHalfPoints(6, 10)).toBe(-6);   // 60 -> -3
    expect(strikeRateHalfPoints(5, 10)).toBe(-10);  // 50 -> -5
    expect(strikeRateHalfPoints(30, 9)).toBeNull(); // under 10 balls
  });
  it('applies the duck rule by dismissal kind', () => {
    const duck = (d: any) => scoreBatting(bat(0, 3, 0, 0, d), 'regulation')
      .find(c => c.code === 'bat_duck')?.halfPoints ?? 0;
    expect(duck('caught')).toBe(-6);
    expect(duck('retired_out')).toBe(-6);
    expect(duck(null)).toBe(0);
    expect(duck('retired_hurt')).toBe(0);
  });
  it('scores Super Over batting as events only', () => {
    const cs = scoreBatting(bat(7, 3, 1, 0, null), 'super_over');
    expect(sum(cs)).toBe(9);
    expect(cs.every(c => c.phase === 'super_over')).toBe(true);
    expect(cs.map(c => c.code).sort()).toEqual(['bat_fours', 'bat_runs']);
    expect(sum(scoreBatting(bat(0, 1, 0, 0, 'bowled'), 'super_over'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run packages/scoring/test/batting.test.ts`. Expected: FAIL, the module is not found.
- [ ] **Step 3: Implement `bands.ts` and `batting.ts`** using the signatures and constants above. Omit zero-value components.
- [ ] **Step 4: Run the tests to confirm they pass.** Run the same command. Expected: 5 passed.
- [ ] **Step 5: Commit.** `git commit -am "feat(scoring): batting points, milestones, strike-rate bands"`

---

### Task 3: Bowling scoring

**Files:**
- Create: `packages/scoring/src/bowling.ts`
- Test: `packages/scoring/test/bowling.test.ts`

**Interfaces:**
- Consumes: `bandHalfPoints`, `ECON_THRESHOLDS`, and `ECON_POINTS` from Task 2.
- Produces:
  - `economyHalfPoints(runsConceded: number, legalBalls: number): HalfPoints | null`, which returns `null` when `legalBalls < 12`.
  - `scoreBowling(b: BowlingStats, phase): ScoreComponent[]`.

The rules (spec §5.4–5.5):

- **Event points:** wicket +15, dot +0.5, maiden +10, wide delivery −1, no-ball delivery −2.
- **Wicket milestone (regulation only):** 3→+4, 4→+6, 5 or more→+8.
- **Economy (regulation only):** applies only when `legalBalls ≥ 12`.
- **Unknown counts:** a `null` count produces no component.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { scoreBowling, economyHalfPoints } from '../src/bowling.js';

const sum = (cs: { halfPoints: number }[]) => cs.reduce((s, c) => s + c.halfPoints, 0);
const bowl = (o: Partial<any>) => ({ legalBalls: 24, runsConceded: 30, wickets: 0, dots: 0,
  maidens: 0, wideDeliveries: 0, noBallDeliveries: 0, ...o });

describe('scoreBowling', () => {
  it('scores Bumrah 3/12 from 20 legal balls with 12 dots as 62', () => {
    expect(sum(scoreBowling(bowl({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 }), 'regulation'))).toBe(124);
  });
  it('penalizes wides and no-balls per delivery', () => {
    const cs = scoreBowling(bowl({ wickets: 1, dots: 8, wideDeliveries: 2, noBallDeliveries: 1 }), 'regulation');
    expect(sum(cs)).toBe(34); // 15 + 4 + 2 - 2 - 2 = 17 points
  });
  it('scores a maiden without economy under 12 legal balls', () => {
    expect(sum(scoreBowling(bowl({ legalBalls: 6, runsConceded: 0, dots: 4, maidens: 1 }), 'regulation'))).toBe(24);
  });
  it('uses exact economy boundaries', () => {
    expect(economyHalfPoints(16, 24)).toBe(10);   // 4.0 -> +5
    expect(economyHalfPoints(15, 24)).toBe(14);   // 3.75 -> +7
    expect(economyHalfPoints(60, 24)).toBe(-14);  // 15.0 -> -7
    expect(economyHalfPoints(59, 24)).toBe(-10);  // 14.75 -> -5
    expect(economyHalfPoints(18, 12)).toBe(0);    // 9.0 -> 0
    expect(economyHalfPoints(5, 11)).toBeNull();
  });
  it('applies wicket milestones', () => {
    const m = (w: number) => scoreBowling(bowl({ wickets: w }), 'regulation')
      .find(c => c.code === 'bowl_milestone')?.halfPoints ?? 0;
    expect([2,3,4,5,6].map(m)).toEqual([0,8,12,16,16]);
  });
  it('handles a bowler with zero legal balls', () => {
    const cs = scoreBowling(bowl({ legalBalls: 0, runsConceded: 5, dots: 0, wideDeliveries: 3 }), 'regulation');
    expect(sum(cs)).toBe(-6);
    expect(cs.some(c => c.code === 'bowl_economy')).toBe(false);
  });
  it('omits unknown ball-level counts', () => {
    const cs = scoreBowling(bowl({ wickets: 1, dots: null, maidens: null, wideDeliveries: null, noBallDeliveries: null }), 'regulation');
    expect(cs.map(c => c.code).sort()).toEqual(['bowl_economy', 'bowl_wickets']);
  });
  it('scores Super Over bowling as events only', () => {
    const cs = scoreBowling(bowl({ legalBalls: 6, runsConceded: 8, wickets: 1, dots: 2 }), 'super_over');
    expect(sum(cs)).toBe(32);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run packages/scoring/test/bowling.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `bowling.ts`.**
- [ ] **Step 4: Run the tests to confirm they pass.** Expected: 8 passed.
- [ ] **Step 5: Commit.** `git commit -am "feat(scoring): bowling points, per-delivery extras, economy bands"`

---

### Task 4: Fielding, Super Overs, `scorePlayerMatch`, golden tests

**Files:**
- Create: `packages/scoring/src/fielding.ts`, `packages/scoring/src/score.ts`
- Modify: `packages/scoring/src/index.ts` (export `scorePlayerMatch`, `scoreBatting`, `scoreBowling`, `scoreFielding`, and the band helpers)
- Test: `packages/scoring/test/golden.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `scoreFielding(f: FieldingStats, phase): ScoreComponent[]`: catch +4, stumping +8, run-out +8, in both phases.
  - `scorePlayerMatch(stats: PlayerMatchStats): ScoreResult`. It returns regulation components first, then Super Over components. `totalHalfPoints` is the sum of all components. `flags` is copied from the input.

- [ ] **Step 1: Write the failing golden tests (spec §5.9)**

```ts
import { describe, it, expect } from 'vitest';
import { scorePlayerMatch } from '../src/index.js';

const noField = { catches: 0, stumpings: 0, runOuts: 0 };
const pm = (regulation: any, superOver: any = null) =>
  ({ fixtureId: 'f', playerId: 'p', teamId: 't', regulation, superOver, flags: [] });
const bowl = (o: any) => ({ legalBalls: 24, runsConceded: 30, wickets: 0, dots: 0, maidens: 0,
  wideDeliveries: 0, noBallDeliveries: 0, ...o });

describe('golden examples (spec 5.9)', () => {
  it('Marsh IPL 2025 m64 = 92.5', () => {
    const r = scorePlayerMatch(pm({ batting: { runs: 117, ballsFaced: 64, fours: 10, sixes: 8, dismissal: 'caught' }, bowling: null, fielding: noField }));
    expect(r.totalHalfPoints).toBe(185);
    expect(r.rulesVersion).toBe('t20-v0.7');
  });
  it('Inglis IPL 2025 m69 = 60.0', () => {
    expect(scorePlayerMatch(pm({ batting: { runs: 73, ballsFaced: 42, fours: 9, sixes: 3, dismissal: 'caught' }, bowling: null,
      fielding: { ...noField, catches: 1 } })).totalHalfPoints).toBe(120);
  });
  it('Bumrah IPL 2025 m63 = 62.0', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 }), fielding: noField })).totalHalfPoints).toBe(124);
  });
  it('constructed per-delivery extras bowler = 17.0', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ wickets: 1, dots: 8, wideDeliveries: 2, noBallDeliveries: 1 }), fielding: noField })).totalHalfPoints).toBe(34);
  });
  it('credited run-out fielder = +8', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: null, fielding: { ...noField, runOuts: 1 } })).totalHalfPoints).toBe(16);
  });
  it('Super Over adds events only (48 reg runs + 7 SO runs with a four = 38.5)', () => {
    const r = scorePlayerMatch(pm(
      { batting: { runs: 48, ballsFaced: 35, fours: 4, sixes: 2, dismissal: null }, bowling: null, fielding: noField },
      { batting: { runs: 7, ballsFaced: 3, fours: 1, sixes: 0, dismissal: null }, bowling: null, fielding: noField }));
    expect(r.totalHalfPoints).toBe(77);
    expect(r.components.filter(c => c.phase === 'super_over').map(c => c.code).sort()).toEqual(['bat_fours', 'bat_runs']);
  });
  it('a player who batted only in the Super Over gets no duck', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: null, fielding: noField },
      { batting: { runs: 0, ballsFaced: 1, fours: 0, sixes: 0, dismissal: 'bowled' }, bowling: null, fielding: noField })).totalHalfPoints).toBe(0);
  });
  it('caught and bowled earns wicket and catch', () => {
    expect(scorePlayerMatch(pm({ batting: null, bowling: bowl({ legalBalls: 6, runsConceded: 10, wickets: 1 }),
      fielding: { ...noField, catches: 1 } })).totalHalfPoints).toBe(38);
  });
  it('passes flags through and total equals component sum', () => {
    const flag = { code: 'runout_fielder_missing' as const, fixtureId: 'f', detail: 'x' };
    const r = scorePlayerMatch({ ...pm({ batting: null, bowling: null, fielding: noField }), flags: [flag] });
    expect(r.flags).toEqual([flag]);
    expect(r.totalHalfPoints).toBe(r.components.reduce((s, c) => s + c.halfPoints, 0));
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run packages/scoring/test/golden.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `fielding.ts` and `score.ts`, and update `index.ts`.**
- [ ] **Step 4: Run the whole suite and typecheck.** Run `pnpm test && pnpm typecheck`. Expected: all scoring tests pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(scoring): fielding, super overs, scorePlayerMatch with golden tests"`

---

## Phase B: Sportmonks data (🌐 steps need Sportmonks access)

### Task 5: Sportmonks client with raw archive

**Files:**
- Create: `packages/sportmonks/package.json` (`@fc/sportmonks`, depends on `@fc/scoring: workspace:*`, `zod`, `tsx`), `tsconfig.json`, `src/config.ts`, `src/archive.ts`, `src/rateLimit.ts`, `src/client.ts`, `src/endpoints.ts`
- Test: `packages/sportmonks/test/archive.test.ts`, `packages/sportmonks/test/client.test.ts`

**Interfaces:**
- Produces:

```ts
// archive.ts
export interface ArchiveEntry { endpoint: string; params: Record<string, string>; fetchedAt: string; status: number; file: string; }
export interface RawArchive {
  save(endpoint: string, params: Record<string, string>, status: number, body: unknown, fetchedAt: Date): Promise<ArchiveEntry>;
  readBody(entry: ArchiveEntry): Promise<unknown>;
  entries(): AsyncIterable<ArchiveEntry>;          // reads manifest.jsonl in order
}
export function createFileArchive(rootDir: string): RawArchive;

// client.ts
export class SportmonksError extends Error { status: number; endpoint: string; }
export interface SportmonksClient {
  get(path: string, query?: Record<string, string>): Promise<{ body: unknown; entry: ArchiveEntry }>;
}
export function createClient(opts: {
  token: string; archive: RawArchive; baseUrl?: string; fetchImpl?: typeof fetch;
  maxPerHourPerEndpoint?: number; sleep?: (ms: number) => Promise<void>; now?: () => Date;
}): SportmonksClient;

// endpoints.ts
export const BASE_URL = 'https://cricket.sportmonks.com/api/v2.0';
export const FIXTURE_INCLUDES = ['batting', 'bowling', 'balls', 'lineup', 'runs', 'scoreboards'] as const;
export const paths = { leagues: '/leagues', seasons: '/seasons', season: (id: string) => `/seasons/${id}`,
  fixture: (id: string) => `/fixtures/${id}`, livescores: '/livescores', scores: '/scores',
  teamSquad: (teamId: string, seasonId: string) => `/teams/${teamId}/squad/${seasonId}`,
  player: (id: string) => `/players/${id}` };
```

**Behavior:**

- **Archive layout:** Each body goes to `<root>/sportmonks/<yyyy>/<mm>/<dd>/<endpoint-slug>/<epochMs>-<seq>.json.gz`, and one JSON line per call is appended to `<root>/sportmonks/manifest.jsonl`.
- **Token handling:** `params` never contains `api_token`.
- **Retries:** On 429 or 5xx, retry up to 5 attempts with backoff of 1, 2, 4, 8 s. Other non-2xx statuses throw `SportmonksError` with no retry. The error message never contains the token.
- **Rate limit:** A sliding one-hour window per endpoint path, with ids collapsed into the slug (`/fixtures/:id`).

- [ ] **Step 1: Write the failing tests**
  - `archive.test.ts` uses a temp directory:
    - `save` then `readBody` round-trips `{a:1}`.
    - The file is gzip.
    - `entries()` yields saved entries in order.
  - `client.test.ts` uses a fake `fetchImpl`, `sleep`, and `now`:
    - **URL:** `get('/fixtures/123', { include: 'batting,bowling' })` requests a URL whose path is `/api/v2.0/fixtures/123` and whose query has `api_token=T` and `include=batting,bowling`.
    - **Archive before return:** the body is archived before it's returned, and `entry.params` has no `api_token`.
    - **429 retry:** 429, 429, 200 → resolves; `sleep` was called with 1000 then 2000.
    - **401:** rejects with `SportmonksError` (`status` 401), the fetch was called once, and the error message does not contain `T`.
    - **Rate limit:** with `maxPerHourPerEndpoint: 2`, the third call to the same endpoint within the hour calls `sleep` with the ms until the window frees.
- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run packages/sportmonks`. Expected: FAIL.
- [ ] **Step 3: Implement `config.ts`** (reads `SPORTMONKS_API_TOKEN` and `FC_DATA_DIR`, and throws a clear message if the token is missing), plus `archive.ts`, `rateLimit.ts`, `client.ts`, and `endpoints.ts`. Use `node:zlib` gzip and global `fetch`.
- [ ] **Step 4: Run the tests to confirm they pass.** Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(sportmonks): client with retries, rate limit, raw archive"`

---

### Task 6: IPL discovery, raw history pull, fixture export, field map 🌐

**Files:**
- Create: `packages/sportmonks/src/discover.ts`, `src/pull.ts`, `src/cli/list-fixtures.ts`, `src/cli/pull-history.ts`, `src/cli/pull-squads.ts`, `src/cli/export-fixture.ts`
- Create: `packages/sportmonks/FIELD_MAP.md`, `packages/sportmonks/test/fixtures/README.md`, exported fixtures under `test/fixtures/`
- Modify: `packages/sportmonks/package.json`, adding scripts `sm:list-fixtures`, `sm:pull-history`, `sm:pull-squads`, `sm:export-fixture` (each `tsx src/cli/<name>.ts`)
- Test: `packages/sportmonks/test/discover.test.ts`, `packages/sportmonks/test/pull.test.ts`

**Interfaces:**
- Consumes: `SportmonksClient`, `paths`, `FIXTURE_INCLUDES` (Task 5).
- Produces:

```ts
export interface FixtureListing { fixtureId: string; seasonId: string; startingAt: string; localTeamId: string;
  visitorTeamId: string; round: string | null; status: string; superOver: boolean; }
export function findIplLeagueId(client: SportmonksClient): Promise<string>;   // league named "Indian Premier League"
export function listIplSeasons(client: SportmonksClient, leagueId: string): Promise<{ seasonId: string; year: number }[]>;
export function listSeasonFixtures(client: SportmonksClient, seasonId: string): Promise<FixtureListing[]>;
export function pullHistory(client: SportmonksClient, archive: RawArchive, opts: { fromYear: number; toYear: number;
  log?: (line: string) => void }): Promise<{ fetched: number; skipped: number; failed: string[] }>;
export function pullSquads(client: SportmonksClient, seasonId: string, teamIds: string[]): Promise<void>;
```

**`pullHistory` behavior:**
- It first fetches `paths.scores` once.
- For each season in range, it fetches every fixture with `include=FIXTURE_INCLUDES`.
- It is resumable: it skips any fixture id that already has a 2xx `/fixtures/:id` entry in the manifest.
- Failures are collected and do not stop the run.

- [ ] **Step 1: Write the failing tests** (stub client returning canned bodies):
  - `findIplLeagueId` picks the league whose name is `Indian Premier League` from a list of three.
  - `listIplSeasons` parses the year from the season name.
  - `pullHistory` over 2 seasons × 2 fixtures fetches 4 fixtures plus `/scores`.
  - Resume: a second run skips all 4.
  - One fixture returning 500 five times lands in `failed` while the others succeed.
- [ ] **Step 2: Run the tests to confirm they fail, then implement until they pass.** Run `pnpm vitest run packages/sportmonks/test/discover.test.ts packages/sportmonks/test/pull.test.ts`.
- [ ] **Step 3: Commit.** `git commit -am "feat(sportmonks): IPL discovery and resumable history pull"`
- [ ] **Step 4 🌐: Verify the endpoint paths and includes against live responses.** Run `pnpm sm:list-fixtures --season 2025`.
  - Expected: about 74 rows with dates and team ids.
  - If any path or include in `endpoints.ts` is rejected, check https://docs.sportmonks.com/v2/cricket-api, fix it in `endpoints.ts` only, and note the fix in `FIELD_MAP.md`.
- [ ] **Step 5 🌐: Run the full pull.** Run `pnpm sm:pull-history --from 2008 --to 2026`.
  - Expected: it completes, with `failed` empty or listed.
  - Rerunning prints that everything was skipped.
  - About 1,150 fixtures take roughly an hour at the rate limit.
- [ ] **Step 6 🌐: Export test fixtures.** Use `pnpm sm:export-fixture <fixtureId> <name>`, which writes pretty JSON of the latest archived body. Find these IPL 2025 matches by date and teams in the `sm:list-fixtures` output:
  - `ipl2025-m64-gt-lsg.json` (22 May; Marsh 117)
  - `ipl2025-m63-mi-dc.json` (21 May; Bumrah 3/12)
  - `ipl2025-m69-pbks-mi.json` (26 May; Inglis 73)
  - `ipl2025-m32-dc-rr-superover.json` (16 April; Super Over)
  - `ipl2025-m44-kkr-pbks-noresult.json` (26 April; abandoned after one innings)
  - one 2025 fixture with at least one run-out and, if possible, a catch by a substitute (`ipl2025-fielding-sample.json`)

  List each in `test/fixtures/README.md` with its fixture id and why it was chosen.
- [ ] **Step 7: Write `FIELD_MAP.md` from the exported fixtures.** For each item below, give the exact field path or value and the fixture where you saw it:
  - batting: runs, balls, fours, sixes
  - how a batting record identifies the dismissal (score id → name), with every dismissal name seen across the 2025 archive and its `DismissalKind`
  - the catch or stumping fielder field
  - the run-out fielder field
  - how substitute catches and run-outs are marked, and whether the substitute's player id is given
  - scoreboard codes for regulation innings and for Super Over innings (from m32)
  - how a ball records batter runs, wides, no-balls, byes, leg-byes, and wickets
  - bowling-card fields
  - the lineup's impact-substitute marker
  - fixture status values for finished, abandoned, and no-result
  - the player position field and values

  Checkable: every item has a value and a fixture id, or "not present" with the fallback from spec §12.3.
- [ ] **Step 8: Commit.** `git add packages/sportmonks && git commit -m "chore(sportmonks): export real test fixtures and field map"`

---

### Task 7: Normalizer: fixture metadata, batting, fielding

**Files:**
- Create: `packages/sportmonks/src/schema.ts`, `src/fieldMap.ts`, `src/normalize/meta.ts`, `src/normalize/batting.ts`
- Test: `packages/sportmonks/test/normalize-batting.test.ts`

**Interfaces:**
- Consumes: `FIELD_MAP.md` (Task 6), and `PlayerMatchStats`, `DataFlag`, and `DismissalKind` (Task 1).
- Produces:

```ts
// fieldMap.ts — values taken from FIELD_MAP.md
export function dismissalKindFromScoreName(name: string): DismissalKind | 'not_out' | null; // null = unknown
export function isSubstituteDismissal(name: string): boolean;
export function phaseOfScoreboard(code: string): 'regulation' | 'super_over';
export type ScoreCatalog = ReadonlyMap<string, { name: string }>;   // score id -> score, built from /scores
export function buildScoreCatalog(scoresBody: unknown): ScoreCatalog;

// normalize/meta.ts
export interface FixtureMeta { fixtureId: string; leagueId: string; seasonId: string; startingAt: string;
  status: string; round: string | null; localTeamId: string; visitorTeamId: string;
  superOver: boolean; hasBallByBall: boolean; }
export function fixtureMeta(raw: unknown): FixtureMeta;

// normalize/batting.ts
export function battingAndFielding(raw: unknown, catalog: ScoreCatalog):
  { players: Map<string, PlayerMatchStats>; flags: DataFlag[] };   // bowling left null; filled in Task 8
```

**Rules (spec §5.1, §5.6):**

- **Who gets a record:**
  - Every lineup player gets a `PlayerMatchStats` with zeroed fielding.
  - A fielder credited in a dismissal who is not in the lineup also gets a record, with `teamId` = the fielding team.
- **Phases:** Each batting record goes to its phase via `phaseOfScoreboard`.
- **Fielding credit:**
  - Caught: +1 catch to the credited fielder.
  - Caught and bowled: +1 catch to the bowler.
  - Stumped: +1 stumping to the credited fielder.
  - Run out: +1 run-out to the run-out fielder only.
- **Flags:**
  - Run-out with no fielder: `runout_fielder_missing`.
  - Substitute dismissal with no player id: `sub_fielder_unidentified`.
  - Unknown dismissal name: `unknown_dismissal`, with `dismissal: null`.
  - A batting record that fails its zod schema: `unparseable_record`, and the record is skipped.

- [ ] **Step 1: Write the failing tests** using the exported fixtures:
  - **m64:** Marsh's regulation batting is `{ runs: 117, ballsFaced: 64, fours: 10, sixes: 8 }` with a non-null dismissal.
  - **m69:** Inglis has `regulation.fielding.catches === 1` and batting 73/42/9/3.
  - **m32:** the Super Over is split out. KL Rahul has `superOver.batting.runs === 7` with 1 four. Stubbs has 6 runs with 1 six. Hetmyer has 6 runs with 1 four. Parag has 4 runs with 1 four. Their regulation batting excludes these. These values come from the handoff's Super Over deltas. If the official scorecard differs, stop and report rather than changing the assertions.
  - **m44:** normalizes without throwing. One side has batting records. `fixtureMeta(...).status` equals the abandoned/no-result value in FIELD_MAP.
  - **Washout:** a copy of m44 with batting, bowling, and balls emptied normalizes to lineup players with null batting and bowling, zeroed fielding, and no flags.
  - **Substitute not in the lineup:** a copy of m64 with one caught dismissal's fielder id changed to `999999`, an id in neither lineup, yields a record for `999999` with `catches: 1` and `teamId` = the fielding team.
  - **Fielding sample:** every run-out has exactly one credited fielder or a `runout_fielder_missing` flag. A substitute fielder not in the lineup gets his own record.
  - **Shape drift:** a deep copy of m64 with one batting record's runs field deleted yields one `unparseable_record` flag, and every other batter is still present.
- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run packages/sportmonks/test/normalize-batting.test.ts`.
- [ ] **Step 3: Implement** `schema.ts` (zod, only the fields named in FIELD_MAP), `fieldMap.ts`, `meta.ts`, and `batting.ts`.
- [ ] **Step 4: Run the tests to confirm they pass.**
- [ ] **Step 5: Commit.** `git commit -am "feat(sportmonks): normalize fixture meta, batting and fielding"`

---

### Task 8: Normalizer: ball-by-ball bowling, reconciliation, end-to-end golden

**Files:**
- Create: `packages/sportmonks/src/normalize/bowling.ts`, `src/normalize/index.ts`
- Test: `packages/sportmonks/test/normalize-bowling.test.ts`, `packages/sportmonks/test/end-to-end.test.ts`

**Interfaces:**
- Consumes: Task 7 and `scorePlayerMatch` (Task 4).
- Produces:

```ts
export function bowlingFromBalls(raw: unknown): { byPlayerPhase: Map<string, { regulation: BowlingStats | null; superOver: BowlingStats | null }>; flags: DataFlag[] };
export interface NormalizedFixture { meta: FixtureMeta; players: PlayerMatchStats[]; flags: DataFlag[]; }
export function normalizeFixture(raw: unknown, catalog: ScoreCatalog): NormalizedFixture;
```

**Rules (spec §5.4–5.5), computed per bowler per phase from `balls`:**

- **Legal ball:** neither a wide nor a no-ball.
- **Runs conceded:** batter runs + wide runs + no-ball runs. Byes and leg-byes are excluded.
- **Dot:** a legal ball with zero team runs.
- **Maiden:** an over (grouped by over number and bowler) in which this bowler bowled 6 legal balls and conceded 0 bowler-charged runs.
- **Extras:** wide deliveries and no-ball deliveries are counted per delivery.
- **Wickets:** bowler-credited kinds only (bowled, caught, caught and bowled, LBW, stumped, hit wicket).

**Data handling:**
- When `balls` is absent, take legal balls, runs, and wickets from the bowling card. Set dots, maidens, and extras to `null`, and add a `ball_data_missing` flag.
- When ball-derived overs, runs, or wickets differ from the card, keep the ball-derived values and add a `bowling_card_mismatch` flag whose detail includes both sets of values.

- [ ] **Step 1: Write the failing tests**
  - **m63:** Bumrah's regulation bowling is `{ legalBalls: 20, runsConceded: 12, wickets: 3, dots: 12 }`.
  - **m32:** Sandeep Sharma's Super Over bowling is `{ legalBalls: 4, runsConceded: 13, dots: 0 }` and is separate from his regulation figures.
  - **Missing balls:** a copy of m64 with `balls` removed yields card-based bowling with null dots and a `ball_data_missing` flag.
  - **End to end:** `normalizeFixture` then `scorePlayerMatch` gives Marsh (m64) 185, Inglis (m69) 120, and Bumrah (m63) 124 half-points.
  - **If a golden value doesn't match:** do not edit the expected value. Write the source evidence (scorecard figures vs the handoff) into `packages/sportmonks/RECONCILIATION.md` and stop the task for the commissioner's review (spec §5.9).
- [ ] **Step 2: Run the tests to confirm they fail.**
- [ ] **Step 3: Implement `bowling.ts` and `normalize/index.ts`.** `normalizeFixture` merges the batting/fielding and bowling results into one record per player.
- [ ] **Step 4: Run the whole suite.** Run `pnpm test && pnpm typecheck`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(sportmonks): ball-by-ball bowling, reconciliation, end-to-end golden tests"`

---

### Task 9: History scoring and coverage report

**Files:**
- Create: `packages/sportmonks/src/history.ts`, `src/cli/build-history.ts` (script `sm:build-history`)
- Test: `packages/sportmonks/test/history.test.ts`

**Interfaces:**
- Consumes: `RawArchive` (Task 5), `normalizeFixture` (Task 8), `scorePlayerMatch` (Task 4).
- Produces:

```ts
export interface ScoredPlayerMatch { meta: FixtureMeta; stats: PlayerMatchStats; score: ScoreResult; }
export interface SeasonCoverage { year: number; seasonId: string; fixturesListed: number; fixturesFetched: number;
  withBatting: number; withBallByBall: number; superOverFixtures: number; flagsByCode: Record<string, number>; }
export function buildHistory(archive: RawArchive, outDir: string): Promise<SeasonCoverage[]>;
```

**Output:**
- `outDir/ipl-<year>.jsonl`: one `ScoredPlayerMatch` per line, using the latest archived body per fixture.
- `outDir/coverage.json`: a `SeasonCoverage[]`.
- Rebuilding produces byte-identical output.

- [ ] **Step 1: Write the failing tests** using a temp archive seeded with the m64, m32, and m44 exported fixtures plus a canned `/scores` body:
  - It writes `ipl-2025.jsonl` with one line per normalized player.
  - Coverage shows `fixturesFetched: 3`, `superOverFixtures: 1`, and `withBallByBall: 3`.
  - The m44 players are present with only first-innings events.
  - A second run produces identical file contents.
- [ ] **Step 2: Run the tests to confirm they fail, then implement until they pass.**
- [ ] **Step 3: Build the full history.** Run `pnpm sm:build-history` against the full archive from Task 6. It can run anywhere the archive has been copied. Expected: `data/history/coverage.json` lists 2008–2026. Record any season with `withBallByBall` below `fixturesFetched` for gate 6.
- [ ] **Step 4: Commit.** `git commit -am "feat(sportmonks): scored IPL history and coverage report"`

---

### Task 10: Live recorder and replay harness 🌐

**Files:**
- Create: `packages/sportmonks/src/record.ts`, `src/replay.ts`, `src/cli/record.ts` (script `sm:record`)
- Test: `packages/sportmonks/test/record.test.ts`, `packages/sportmonks/test/replay.test.ts`

**Interfaces:**
- Consumes: `SportmonksClient`, `normalizeFixture`, `scorePlayerMatch`.
- Produces:

```ts
export function nextPollDelayMs(now: Date, startingAt: Date, status: string, finishedAt: Date | null): number | null; // null = stop
export function recordFixture(client: SportmonksClient, fixtureId: string, dir: string,
  opts?: { now?: () => Date; sleep?: (ms: number) => Promise<void> }): Promise<void>;
export function readRecording(dir: string): AsyncIterable<{ seq: number; fetchedAt: string; body: unknown }>;
export function replayScores(dir: string, catalog: ScoreCatalog): AsyncIterable<{ seq: number; fetchedAt: string;
  scores: Map<string, ScoreResult> }>;
```

**Poll schedule (spec §11):**

| When | Interval |
|---|---|
| More than 60 min before start | Wait until 60 min before |
| From 60 min before until live | 5 min |
| While live | 30 s |
| After finished, up to 2 h | 10 min |
| More than 2 h after finished | Stop |

The status groups ("live" and "finished") come from FIELD_MAP.

**Recording output:** Each snapshot is archived through the client and also written to `dir/<seq>.json.gz`. `dir/timeline.jsonl` gets a line per snapshot with `{ seq, fetchedAt, status, lineupPresent, ballsCount }`.

- [ ] **Step 1: Write the failing tests**
  - `nextPollDelayMs` returns:
    - 90 min before start → 30 min (wait until the 60-minute mark)
    - 30 min before → 300000
    - live → 30000
    - 1 h after finish → 600000
    - 3 h after finish → `null`
  - `replayScores` over a synthetic 3-snapshot recording, built from m64 with `balls` truncated to 40, 80, and all deliveries, yields non-decreasing total balls. Marsh's final snapshot score is 185.
- [ ] **Step 2: Run the tests to confirm they fail, then implement until they pass.**
- [ ] **Step 3: Commit.** `git commit -am "feat(sportmonks): live recorder with poll schedule and replay"`
- [ ] **Step 4 🌐: Record at least 3 Big Bash matches** from before the toss to 2 h after the finish. Run `pnpm sm:record --fixture <id>` in a terminal, or in the background on the Unraid server, starting more than 60 min before each start. Expected: each `timeline.jsonl` shows `lineupPresent` turning true and `status` reaching finished.

---

### Task 11: Sportmonks verification report 🌐

**Files:**
- Create: `packages/sportmonks/src/gates.ts`, `src/cli/gates.ts` (script `sm:gates`)
- Create (output): `docs/sportmonks-verification.md`
- Test: `packages/sportmonks/test/gates.test.ts`

**Interfaces:**
- Consumes: the history output (Task 9), recordings (Task 10), and squad archives (`pullSquads`, Task 6).
- Produces: `buildGateReport(input: { historyDir: string; recordingsDir: string; archive: RawArchive }): Promise<string>`, which returns markdown with one section per gate 1–8 (spec §12.3).

**What each gate section reports:**

| Gate | Contents |
|---|---|
| 1 | Run-out count, % with a credited fielder, and 10 sample run-outs (fixture, batter, credited fielder) for manual check |
| 2 | Substitute dismissals, % with a player id, % of those ids missing from the lineup |
| 3 | Fixtures with `superOver`, and the scoreboard codes seen |
| 4 | `bowling_card_mismatch` rate per season |
| 5 | Per recording, minutes between the lineup first appearing and `startingAt` |
| 6 | The coverage table from `coverage.json` |
| 7 | Per recording, whether any player's score changed between the finished snapshot and the last post-match snapshot, and between that and the history pull |
| 8 | For the IPL 2027 season, the count of squad players with and without a position, with the ones missing listed |

- [ ] **Step 1: Write the failing test.** From a temp history dir holding the 3 test fixtures and a synthetic 2-snapshot recording, `buildGateReport` returns markdown containing the headings `Gate 1` through `Gate 8`, and the Gate 3 section lists the m32 fixture id.
- [ ] **Step 2: Run the test to confirm it fails, then implement until it passes.** Commit with `git commit -am "feat(sportmonks): verification gate report"`.
- [ ] **Step 3 🌐: Pull IPL 2027 squads.** After the 16 December auction, run `pnpm sm:pull-squads --year 2027`.
- [ ] **Step 4: Generate the report and finish the manual checks.** Run `pnpm sm:gates > docs/sportmonks-verification.md`.
  - **Gate 1 manual check:** check 5 of the listed two-fielder run-outs against the ESPNcricinfo scorecards. Record which fielder Sportmonks credits, the thrower or the one at the stumps.
  - **Spec impact section:** add a final "Spec impact" section listing every finding that changes a detail in spec §5, §11, or §12. Write "none" if nothing does.
- [ ] **Step 5: Commit.** `git add docs/sportmonks-verification.md && git commit -m "docs: Sportmonks verification report"`. Then stop. The commissioner reviews the report before Plan 2 is written.

---

### Task 12 (conditional): Cricsheet import for seasons Sportmonks lacks 🌐

**Run this task only if** gate 6 shows an IPL season with `withBallByBall < fixturesFetched`, or a season missing entirely (spec §12.1). Otherwise, mark it skipped in the report.

**Files:**
- Create: `packages/cricsheet/` (`@fc/cricsheet`), with `src/normalize.ts`, `src/link.ts`, `src/cli/import.ts`
- Test: `packages/cricsheet/test/normalize.test.ts`, `packages/cricsheet/test/cross-source.test.ts`

**Interfaces:**
- Consumes: the types (Task 1), `scorePlayerMatch`, and the gate 1 run-out convention from the report.
- Produces:
  - `normalizeCricsheetMatch(json: unknown): NormalizedFixture`. Ids are prefixed `cs:`, and Super Overs are taken from innings marked `super_over: true`.
  - `linkPlayers(cs: NormalizedFixture, sportmonksPlayers: { id: string; name: string; teamId: string }[]): { linked: Map<string, string>; unresolved: string[] }`.
  - The import appends to `data/history/ipl-<year>.jsonl` only for seasons that gate 6 marked as missing.

**Run-out credit:** credit the run-out to the fielder in the position that gate 1 found Sportmonks credits. Do not credit every listed fielder.

- [ ] **Step 1: Write the failing tests**
  - Normalizing Cricsheet IPL 2025 match 64 (GT v LSG, from the Cricsheet IPL zip) gives Marsh 117/64/10/8.
  - **Cross-source:** for that match, every linked player's `scorePlayerMatch` total equals the Sportmonks-derived total. If any player differs, list it and investigate before continuing.
- [ ] **Step 2: Run the tests to confirm they fail, then implement until they pass.** Commit with `git commit -am "feat(cricsheet): fallback history import"`.
- [ ] **Step 3 🌐: Import the missing seasons.** Download `https://cricsheet.org/downloads/ipl_json.zip`, or reuse the copy from the earlier research, keeping its README and LICENSE (ODC-By). Run `pnpm cs:import --years <missing years>`. Add the result and the unresolved player list to the verification report.

---

## Done when

- `pnpm test` and `pnpm typecheck` pass.
- `data/history/coverage.json` covers 2008–2026.
- At least 3 Big Bash recordings exist.
- `docs/sportmonks-verification.md` has every gate filled in plus a Spec impact section.
- The commissioner has reviewed the report.
