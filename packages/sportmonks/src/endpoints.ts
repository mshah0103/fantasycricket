export const BASE_URL = 'https://cricket.sportmonks.com/api/v2.0';

export const FIXTURE_INCLUDES = ['batting', 'bowling', 'balls', 'lineup', 'runs', 'scoreboards'] as const;

export const paths = {
  leagues: '/leagues',
  seasons: '/seasons',
  season: (id: string) => `/seasons/${id}`,
  fixture: (id: string) => `/fixtures/${id}`,
  livescores: '/livescores',
  scores: '/scores',
  teamSquad: (teamId: string, seasonId: string) => `/teams/${teamId}/squad/${seasonId}`,
  player: (id: string) => `/players/${id}`,
};

/** Request path with numeric id segments collapsed to `:id`. */
export function endpointPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

/** Directory-safe slug of an endpoint path, e.g. `/fixtures/:id` -> `fixtures-id`. */
export function endpointSlug(endpoint: string): string {
  return endpoint.replace(/[/:]+/g, '-').replace(/^-+|-+$/g, '');
}
