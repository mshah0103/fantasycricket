import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { SportmonksError, type SportmonksClient } from './client.js';
import { FIXTURE_INCLUDES, paths } from './endpoints.js';
import { isKnownStatus, statusGroup } from './fieldMap.js';

const MIN = 60_000;
const ERROR_RETRY_MS = 30_000;

/**
 * Delay until the next poll (spec §11), or null to stop.
 * pre: wait until 60 min before start, then 5 min. live (and unknown statuses): 30 s.
 * finished: 10 min until 2 h after `finishedAt` (null = now), then stop.
 */
export function nextPollDelayMs(now: Date, startingAt: Date, status: string, finishedAt: Date | null): number | null {
  switch (statusGroup(status)) {
    case 'finished': {
      const since = finishedAt ? now.getTime() - finishedAt.getTime() : 0;
      return since > 120 * MIN ? null : 10 * MIN;
    }
    case 'live':
      return 30_000;
    case 'pre': {
      const untilStart = startingAt.getTime() - now.getTime();
      return untilStart > 60 * MIN ? untilStart - 60 * MIN : 5 * MIN;
    }
  }
}

type Obj = Record<string, unknown>;
const dataOf = (body: unknown): Obj => {
  const d = (body as Obj | null)?.data;
  return d && typeof d === 'object' ? (d as Obj) : {};
};
/** Length of a collection that is `[...]` or `{ data: [...] }`; 0 when absent. */
function countOf(x: unknown): number {
  if (Array.isArray(x)) return x.length;
  const inner = (x as Obj | null)?.data;
  return Array.isArray(inner) ? inner.length : 0;
}

interface TimelineLine {
  seq: number | null;
  fetchedAt: string;
  status?: string;
  error?: string;
}

async function readTimeline(dir: string): Promise<TimelineLine[]> {
  let text: string;
  try {
    text = await readFile(join(dir, 'timeline.jsonl'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TimelineLine);
}

/**
 * Polls one fixture on the spec §11 schedule until the schedule says stop. Each snapshot is archived by
 * the client and written to `dir/<seq>.json.gz`, with a line in `dir/timeline.jsonl`. Restart-safe:
 * seq numbering and the 2 h post-finish window are recovered from an existing timeline. A
 * `SportmonksError` (after the client's own retries) is logged to the timeline and retried after 30 s;
 * any other error propagates.
 */
export async function recordFixture(
  client: SportmonksClient,
  fixtureId: string,
  dir: string,
  opts: { now?: () => Date; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void } = {},
): Promise<void> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  await mkdir(dir, { recursive: true });

  const prior = await readTimeline(dir);
  let seq = prior.reduce((m, l) => (l.seq !== null && l.seq > m ? l.seq : m), 0);
  const firstFinished = prior.find((l) => l.seq !== null && l.status !== undefined && statusGroup(l.status) === 'finished');
  let finishedAt: Date | null = firstFinished ? new Date(firstFinished.fetchedAt) : null;
  const timelinePath = join(dir, 'timeline.jsonl');

  for (;;) {
    let result: Awaited<ReturnType<SportmonksClient['get']>>;
    try {
      result = await client.get(paths.fixture(fixtureId), { include: FIXTURE_INCLUDES.join(',') });
    } catch (e) {
      if (!(e instanceof SportmonksError)) throw e;
      await appendFile(timelinePath, JSON.stringify({ seq: null, fetchedAt: now().toISOString(), error: e.message }) + '\n');
      // 4xx other than 429 (bad token, forbidden, wrong fixture id) will not fix itself: fail fast.
      if (e.status >= 400 && e.status < 500 && e.status !== 429) {
        throw new Error(`Recording fixture ${fixtureId} stopped: Sportmonks responded with HTTP ${e.status} (not retryable)`);
      }
      log(`#- error: ${e.message}; retrying in ${ERROR_RETRY_MS / 1000}s`);
      await sleep(ERROR_RETRY_MS);
      continue;
    }
    const { body, entry } = result;
    seq += 1;
    await writeFile(join(dir, `${seq}.json.gz`), gzipSync(Buffer.from(JSON.stringify(body ?? null))));

    const data = dataOf(body);
    const status = typeof data.status === 'string' ? data.status : '';
    const line: Record<string, unknown> = {
      seq,
      fetchedAt: entry.fetchedAt,
      status,
      lineupPresent: countOf(data.lineup) > 0,
      ballsCount: countOf(data.balls),
    };
    if (!isKnownStatus(status)) line.unknownStatus = true;
    await appendFile(timelinePath, JSON.stringify(line) + '\n');

    if (finishedAt === null && statusGroup(status) === 'finished') finishedAt = new Date(entry.fetchedAt);
    const parsedStart = new Date(typeof data.starting_at === 'string' ? data.starting_at : NaN);
    const startingAt = Number.isNaN(parsedStart.getTime()) ? now() : parsedStart;
    const delay = nextPollDelayMs(now(), startingAt, status, finishedAt);
    log(`#${seq} status=${status || '(none)'} lineup=${line.lineupPresent} balls=${line.ballsCount} next=${delay === null ? 'stop' : `${delay}ms`}`);
    if (delay === null) return;
    await sleep(delay);
  }
}

/** Snapshots in ascending numeric seq (error lines skipped). */
export async function* readRecording(dir: string): AsyncIterable<{ seq: number; fetchedAt: string; body: unknown }> {
  const lines = (await readTimeline(dir)).filter((l): l is TimelineLine & { seq: number } => l.seq !== null);
  lines.sort((a, b) => a.seq - b.seq);
  for (const l of lines) {
    const body = JSON.parse(gunzipSync(await readFile(join(dir, `${l.seq}.json.gz`))).toString('utf8')) as unknown;
    yield { seq: l.seq, fetchedAt: l.fetchedAt, body };
  }
}
