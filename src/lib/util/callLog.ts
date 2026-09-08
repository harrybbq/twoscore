import { db, dbConfigured } from '@/lib/supabase/server';

export interface CallStat {
  provider: 'tmdb' | 'omdb';
  endpoint: string;
  status: number;
  ms: number;
  cacheHit: boolean;
}

/**
 * Every outbound call is recorded so ingest cost is visible and OMDb's
 * 1000/day free tier can be reasoned about rather than guessed at.
 * Buffered and flushed in batches — one insert per API call would double
 * the round trips we are trying to count.
 */
class CallLog {
  private buf: CallStat[] = [];
  private runId: number | null = null;
  readonly counts = { tmdb: 0, omdb: 0, cacheHits: 0 };

  /** Starts a fresh count. A warm serverless instance reuses this module, so
   *  without the reset the second ingest of the day reports the first one's
   *  calls on top of its own. */
  setRun(id: number | null) {
    this.runId = id;
    this.counts.tmdb = 0;
    this.counts.omdb = 0;
    this.counts.cacheHits = 0;
  }

  record(s: CallStat) {
    this.buf.push(s);
    if (s.cacheHit) this.counts.cacheHits++;
    else this.counts[s.provider]++;
    if (this.buf.length >= 100) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.buf.length || !dbConfigured()) {
      this.buf = [];
      return;
    }
    const rows = this.buf.map((s) => ({
      provider: s.provider,
      endpoint: s.endpoint,
      status: s.status,
      ms: s.ms,
      cache_hit: s.cacheHit,
      run_id: this.runId,
    }));
    this.buf = [];
    const { error } = await db().from('api_calls').insert(rows);
    if (error) console.warn('[callLog] flush failed:', error.message);
  }

  summary() {
    return { ...this.counts };
  }
}

export const callLog = new CallLog();
