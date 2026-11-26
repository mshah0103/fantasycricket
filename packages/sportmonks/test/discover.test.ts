import { describe, expect, it } from 'vitest';
import { findIplLeagueId, findLeagueId, listIplSeasons, listSeasonFixtures } from '../src/discover.js';
import type { SportmonksClient } from '../src/client.js';
import type { ArchiveEntry } from '../src/archive.js';

function stub(handler: (path: string, query?: Record<string, string>) => unknown): SportmonksClient {
  return {
    async get(path, query) {
      return { body: handler(path, query), entry: { endpoint: path, status: 200 } as ArchiveEntry };
    },
  };
}

describe('discover', () => {
  it('findIplLeagueId picks the Indian Premier League', async () => {
    const client = stub(() => ({
      data: [
        { id: 1, name: 'Big Bash League' },
        { id: 8, name: 'Indian Premier League' },
        { id: 3, name: 'The Hundred' },
      ],
    }));
    expect(await findIplLeagueId(client)).toBe('8');
  });

  it('findLeagueId picks a league by exact name and throws when absent', async () => {
    const client = stub(() => ({ data: [{ id: 1, name: 'Big Bash League' }, { id: 8, name: 'Indian Premier League' }] }));
    expect(await findLeagueId(client, 'Big Bash League')).toBe('1');
    await expect(findLeagueId(client, 'Nope')).rejects.toThrow(/Nope/);
  });

  it('findIplLeagueId throws when absent', async () => {
    await expect(findIplLeagueId(stub(() => ({ data: [{ id: 1, name: 'X' }] })))).rejects.toThrow(/Indian Premier League/);
  });

  it('listIplSeasons parses year from name, filters by league, sorts ascending', async () => {
    let seen: Record<string, string> | undefined;
    const client = stub((_p, q) => {
      seen = q;
      return {
        data: [
          { id: 20, league_id: 8, name: '2025' },
          { id: 10, league_id: 8, name: '2008' },
          { id: 15, league_id: 8, name: '2020/21' },
          { id: 99, league_id: 5, name: '2019' },
        ],
      };
    });
    const seasons = await listIplSeasons(client, '8');
    expect(seen).toEqual({ 'filter[league_id]': '8' });
    expect(seasons).toEqual([
      { seasonId: '10', year: 2008 },
      { seasonId: '15', year: 2020 },
      { seasonId: '20', year: 2025 },
    ]);
  });

  it('listSeasonFixtures maps fixtures, accepting plain array or {data}', async () => {
    const fx = { id: 5, season_id: 20, starting_at: '2025-03-22T14:00:00Z', localteam_id: 1, visitorteam_id: 2, round: 'League', status: 'Finished', super_over: false };
    for (const fixtures of [[fx], { data: [fx] }]) {
      const client = stub(() => ({ data: { id: 20, fixtures } }));
      expect(await listSeasonFixtures(client, '20')).toEqual([
        { fixtureId: '5', seasonId: '20', startingAt: '2025-03-22T14:00:00Z', localTeamId: '1', visitorTeamId: '2', round: 'League', status: 'Finished', superOver: false },
      ]);
    }
  });
});
