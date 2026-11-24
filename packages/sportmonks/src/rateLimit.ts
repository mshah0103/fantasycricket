const WINDOW_MS = 3_600_000;

/** Sliding one-hour window per key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  /** Waits (via sleep) until a call is allowed, then records it. */
  async acquire(key: string): Promise<void> {
    const list = this.hits.get(key) ?? [];
    this.hits.set(key, list);
    for (;;) {
      const t = this.now();
      while (list.length > 0 && list[0]! <= t - WINDOW_MS) list.shift();
      if (list.length < this.max) {
        list.push(t);
        return;
      }
      await this.sleep(list[0]! + WINDOW_MS - t);
    }
  }
}
