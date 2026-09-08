/** Token-bucket limiter: at most `rps` starts per rolling second, in order. */
export class RateLimiter {
  private queue: (() => void)[] = [];
  private stamps: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private rps: number) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
  }

  /** Hold every caller off until `until` (ms epoch) — used for 429 Retry-After. */
  private blockedUntil = 0;
  block(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.pump();
  }

  private pump() {
    if (this.timer) return;
    const step = () => {
      this.timer = null;
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 1000);
      if (now < this.blockedUntil) {
        this.schedule(this.blockedUntil - now, step);
        return;
      }
      while (this.queue.length && this.stamps.length < this.rps) {
        this.stamps.push(Date.now());
        this.queue.shift()!();
      }
      if (this.queue.length) {
        const wait = this.stamps.length ? 1000 - (Date.now() - this.stamps[0]) : 10;
        this.schedule(Math.max(wait, 5), step);
      }
    };
    step();
  }

  private schedule(ms: number, fn: () => void) {
    this.timer = setTimeout(fn, ms);
    // Don't hold a serverless function open waiting on an idle limiter.
    this.timer.unref?.();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
