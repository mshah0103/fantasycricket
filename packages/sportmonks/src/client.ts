import type { ArchiveEntry, RawArchive } from './archive.js';
import { BASE_URL, endpointPath } from './endpoints.js';
import { RateLimiter } from './rateLimit.js';

export class SportmonksError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    /** Sanitised low-level error code (e.g. ECONNRESET); never an error message. */
    public code?: string,
  ) {
    super(message);
    this.name = 'SportmonksError';
  }
}

export interface SportmonksClient {
  get(path: string, query?: Record<string, string>): Promise<{ body: unknown; entry: ArchiveEntry }>;
}

function errorCode(e: unknown): string | undefined {
  const pick = (x: unknown) => {
    const c = (x as { code?: unknown } | null)?.code;
    return typeof c === 'string' && /^[A-Z0-9_]{1,40}$/.test(c) ? c : undefined;
  };
  return pick(e) ?? pick((e as { cause?: unknown } | null)?.cause);
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
  /** Per-request timeout; a timed-out request is a network error (retried). Default 30000. */
  timeoutMs?: number;
}): SportmonksClient {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 30_000;
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
        let status: number;
        let ok: boolean;
        let body: unknown;
        try {
          const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
          status = res.status;
          ok = res.ok;
          const text = await res.text();
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = { raw: text };
          }
        } catch (e) {
          // Only the error code is kept: messages may embed the request URL (and token).
          const code = errorCode(e);
          if (attempt >= MAX_ATTEMPTS) {
            throw new SportmonksError(
              `Sportmonks request to ${endpoint} failed: network error${code ? ` (${code})` : ''}`,
              0,
              endpoint,
              code,
            );
          }
          await sleep(BACKOFF_MS[attempt - 1]!);
          continue;
        }
        const entry = await opts.archive.save(path, { ...query }, status, body, now());
        if (ok) return { body, entry };

        const retryable = status === 429 || status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1]!);
          continue;
        }
        throw new SportmonksError(`Sportmonks ${endpoint} responded with HTTP ${status}`, status, endpoint);
      }
    },
  };
}
