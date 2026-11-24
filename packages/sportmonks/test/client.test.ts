import { describe, expect, it, vi } from 'vitest';
import type { ArchiveEntry, RawArchive } from '../src/archive.js';
import { createClient, SportmonksError } from '../src/client.js';
import { loadConfig } from '../src/config.js';

function fakeArchive() {
  const saved: { endpoint: string; params: Record<string, string>; status: number; body: unknown }[] = [];
  const archive: RawArchive = {
    async save(endpoint, params, status, body, fetchedAt) {
      saved.push({ endpoint, params, status, body });
      return { endpoint, params, fetchedAt: fetchedAt.toISOString(), status, file: `f${saved.length}.json.gz` };
    },
    async readBody() { return null; },
    async *entries(): AsyncIterable<ArchiveEntry> {},
  };
  return { archive, saved };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sportmonks client', () => {
  it('builds the URL with token and query, archives before returning', async () => {
    const { archive, saved } = fakeArchive();
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => json(200, { data: 1 }));
    const client = createClient({ token: 'T', archive, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => new Date('2026-04-01T00:00:00Z') });
    const { body, entry } = await client.get('/fixtures/123', { include: 'batting,bowling' });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/v2.0/fixtures/123');
    expect(url.searchParams.get('api_token')).toBe('T');
    expect(url.searchParams.get('include')).toBe('batting,bowling');
    expect(body).toEqual({ data: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.endpoint).toBe('/fixtures/:id');
    expect(entry.params).toEqual({ include: 'batting,bowling' });
    expect(entry.params).not.toHaveProperty('api_token');
    expect(entry.fetchedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('retries 429 with 1s then 2s backoff and archives each attempt', async () => {
    const { archive, saved } = fakeArchive();
    const responses = [json(429, {}), json(429, {}), json(200, { ok: true })];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async (_ms: number) => {});
    const client = createClient({ token: 'T', archive, fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    const { body } = await client.get('/livescores');
    expect(body).toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(saved.map((s) => s.status)).toEqual([429, 429, 200]);
  });

  it('gives up after 5 attempts on 5xx', async () => {
    const { archive } = fakeArchive();
    const fetchImpl = vi.fn(async () => json(503, {}));
    const sleep = vi.fn(async (_ms: number) => {});
    const client = createClient({ token: 'T', archive, fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    await expect(client.get('/livescores')).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000]);
  });

  it('throws SportmonksError on 401 without retry or token leak, archiving it', async () => {
    const { archive, saved } = fakeArchive();
    const fetchImpl = vi.fn(async () => json(401, { message: 'bad' }));
    const client = createClient({ token: 'T', archive, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const err = await client.get('/fixtures/9').catch((e) => e);
    expect(err).toBeInstanceOf(SportmonksError);
    expect(err.status).toBe(401);
    expect(err.endpoint).toBe('/fixtures/:id');
    expect(err.message).not.toContain('T');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saved[0]!.status).toBe(401);
  });

  it('error message never contains a longer token', async () => {
    const { archive } = fakeArchive();
    const fetchImpl = vi.fn(async () => json(404, {}));
    const client = createClient({ token: 'secret-token', archive, fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await client.get('/players/1').catch((e) => e);
    expect(err.message).not.toContain('secret-token');
  });

  it('rate limits per endpoint path, sleeping until the window frees', async () => {
    const { archive } = fakeArchive();
    let t = Date.parse('2026-04-01T00:00:00Z');
    const fetchImpl = vi.fn(async () => json(200, {}));
    const sleep = vi.fn(async (ms: number) => { t += ms; });
    const client = createClient({
      token: 'T', archive, fetchImpl: fetchImpl as unknown as typeof fetch, sleep,
      maxPerHourPerEndpoint: 2, now: () => new Date(t),
    });
    await client.get('/fixtures/1');
    t += 1000;
    await client.get('/fixtures/2');
    t += 1000;
    await client.get('/fixtures/3');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(3_600_000 - 2000);
    // other endpoints unaffected
    sleep.mockClear();
    await client.get('/livescores');
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('loadConfig', () => {
  it('reads token and data dir with default', () => {
    expect(loadConfig({ SPORTMONKS_API_TOKEN: 'x' })).toEqual({ token: 'x', dataDir: './data' });
    expect(loadConfig({ SPORTMONKS_API_TOKEN: 'x', FC_DATA_DIR: '/d' }).dataDir).toBe('/d');
  });
  it('throws naming the variable when missing', () => {
    expect(() => loadConfig({})).toThrow(/SPORTMONKS_API_TOKEN/);
  });
});
