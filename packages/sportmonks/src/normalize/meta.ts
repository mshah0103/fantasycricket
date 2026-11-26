import { FixtureMetaSchema, parseFixtureData } from '../schema.js';

export interface FixtureMeta {
  fixtureId: string;
  leagueId: string;
  seasonId: string;
  startingAt: string; // UTC ISO 8601
  status: string; // FIELD_MAP §1: "Finished" or "Aban."
  round: string | null;
  localTeamId: string;
  visitorTeamId: string;
  superOver: boolean;
  hasBallByBall: boolean;
}

/** Fixture metadata (FIELD_MAP §1). Throws if the body is not a parseable `{ data: {...} }`. */
export function fixtureMeta(raw: unknown): FixtureMeta {
  const d = parseFixtureData(FixtureMetaSchema, raw);
  return {
    fixtureId: String(d.id),
    leagueId: String(d.league_id),
    seasonId: String(d.season_id),
    startingAt: new Date(d.starting_at).toISOString(),
    status: d.status,
    round: d.round ?? null,
    localTeamId: String(d.localteam_id),
    visitorTeamId: String(d.visitorteam_id),
    superOver: d.super_over === true,
    hasBallByBall: d.balls.length > 0,
  };
}
