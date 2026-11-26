import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scorePlayerMatch, type PlayerMatchStats } from '@fc/scoring';
import { buildScoreCatalog, normalizeFixture } from '@fc/sportmonks';
import { applyLinks, linkPlayers, sportmonksLineupPlayers } from '../src/link.js';
import { normalizeCricsheetMatch } from '../src/normalize.js';

// Cross-source check (Task 12 brief, step 1): the same match normalized from Cricsheet and from Sportmonks,
// scored with the same engine, must give every linked player the same total.

const load = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const cs = (file: string) => load(new URL(`./fixtures/${file}`, import.meta.url));
const sm = (file: string) => load(new URL(`../../sportmonks/test/fixtures/${file}`, import.meta.url));
const catalog = buildScoreCatalog(sm('scores.json'));

interface Diff {
  player: string;
  smId: string;
  cricsheet: number;
  sportmonks: number;
  csComponents: string;
  smComponents: string;
}

const components = (p: PlayerMatchStats): string =>
  scorePlayerMatch(p).components.map((c) => `${c.phase === 'super_over' ? 'SO ' : ''}${c.code}=${c.halfPoints}`).join(', ');

/**
 * Normalizes both sources, links Cricsheet players to the Sportmonks lineup and compares every linked total. The
 * Sportmonks fixture is the Cricsheet match's twin, so the same-team surname fallback applies, as in the import.
 */
function crossCheck(csFile: string, matchId: string, smFile: string) {
  const csFixture = normalizeCricsheetMatch(cs(csFile), { matchId });
  const smBody = sm(smFile);
  const smFixture = normalizeFixture(smBody, catalog);
  const { players, teamNames } = sportmonksLineupPlayers(smBody);
  const { linked, unresolved } = linkPlayers(csFixture, players, { teamNames, sameTeamSurname: true });
  const applied = applyLinks(csFixture, linked, { teamNames });
  const smById = new Map(smFixture.players.map((p) => [p.playerId, p]));
  const diffs: Diff[] = [];
  for (const [csId, smId] of linked) {
    const a = applied.players.find((p) => p.playerId === smId)!;
    const b = smById.get(smId);
    if (!b) throw new Error(`linked Sportmonks id ${smId} has no Sportmonks record`);
    const cricsheet = scorePlayerMatch(a).totalHalfPoints;
    const sportmonks = scorePlayerMatch(b).totalHalfPoints;
    if (cricsheet !== sportmonks) {
      diffs.push({ player: csFixture.playerNames[csId]!, smId, cricsheet, sportmonks, csComponents: components(a), smComponents: components(b) });
    }
  }
  return { csFixture, applied, linked, unresolved, diffs };
}

describe('cross-source: Cricsheet vs Sportmonks, same engine', () => {
  it('m64 (GT v LSG): all 25 Cricsheet players link and every total equals the Sportmonks total', () => {
    const { linked, unresolved, diffs, applied } = crossCheck('1473502.json', '1473502', 'ipl2025-m64-gt-lsg.json');
    expect(unresolved).toEqual([]);
    expect(linked.size).toBe(25);
    expect(diffs).toEqual([]);
    // The golden case through the Cricsheet path: Marsh is Sportmonks player 31, 185 half-points (92.5).
    const marsh = applied.players.find((p) => p.playerId === '31')!;
    expect(marsh.teamId).toBe('1979');
    expect(scorePlayerMatch(marsh).totalHalfPoints).toBe(185);
    // Team ids map by name (Sportmonks ball team names), on the fixture too.
    expect(applied.meta).toMatchObject({ localTeamId: '1979', visitorTeamId: '1976' });
  });

  it('m29 (fielding sample): totals equal except Rickelton, whose two run-outs only Sportmonks credits', () => {
    const { csFixture, linked, unresolved, diffs } = crossCheck('1473466.json', '1473466', 'ipl2025-fielding-sample.json');
    // KL Rahul is "Lokesh Rahul" in Sportmonks: the first initials differ, but he is the only Rahul on Delhi
    // Capitals on both sides, so the same-team surname fallback links him (47), and his total is equal.
    expect(unresolved).toEqual([]);
    expect(linked.size).toBe(25);
    expect(linked.get(Object.entries(csFixture.playerNames).find(([, n]) => n === 'KL Rahul')![0])).toBe('47');
    // Task 12 ruling: Cricsheet's fielder order cannot say which fielder Sportmonks credits, so no Cricsheet
    // run-out is credited (runout_fielder_missing). Sportmonks credits runout_by_id: Rickelton (662) for
    // Ashutosh Sharma and Kuldeep Yadav, 2 x 8 points = 16 points = 32 half-points. Any other difference is a bug.
    expect(diffs.map(({ player, smId, sportmonks, cricsheet }) => ({ player, smId, delta: sportmonks - cricsheet }))).toEqual([
      { player: 'RD Rickelton', smId: '662', delta: 32 },
    ]);
    expect(diffs[0]!.smComponents).toContain('field_runouts=32');
    expect(diffs[0]!.csComponents).not.toContain('field_runouts');
  });
});
