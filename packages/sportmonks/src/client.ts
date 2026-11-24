import type { ArchiveEntry, RawArchive } from './archive.js';
import { BASE_URL, endpointPath } from './endpoints.js';
import { RateLimiter } from './rateLimit.js';

export class SportmonksError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
  ) {
    super(message);
    this.name = 'SportmonksError';
  }
}

export interface SportmonksClient {
  get(path: string, query?: Record<string, string>): Promise<{ body: unknown; entry: ArchiveEntry }>;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1000, 2000, 4000, 8000];

export function createClient(opts: {
  token: string;
  archive: RawArchive;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxPerHourPerEndpoint?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): SportmonksClient {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const limiter = new RateLimiter(opts.maxPerHourPerEndpoint ?? 1500, () => now().getTime(), sleep);

  return {
    async get(path, query = {}) {
      const endpoint = endpointPath(path);
      const url = new URL(baseUrl + path);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      url.searchParams.set('api_token', opts.token);

      for (let attempt = 1; ; attempt++) {
        await limiter.acquire(endpoint);
        let res: Response;
        try {
          res = await fetchImpl(url.toString());
        } catch {
          // Network error text is not propagated: it could embed the request URL (and token).
          if (attempt >= MAX_ATTEMPTS) {
            throw new SportmonksError(`Sportmonks request to ${endpoint} failed: network error`, 0, endpoint);
          }
          await sleep(BACKOFF_MS[attempt - 1]!);
          continue;
        }
        const text = await res.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = { raw: text };
        }
        const entry = await opts.archive.save(endpoint, { ...query }, res.status, body, now());
        if (res.ok) return { body, entry };

        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1]!);
          continue;
        }
        throw new SportmonksError(`Sportmonks ${endpoint} responded with status ${res.status}`, res.status, endpoint);
      }
    },
  };
}
