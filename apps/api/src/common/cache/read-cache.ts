import { Injectable } from "@nestjs/common";

type Entry = { version: number; at: number; value: Promise<unknown> };

/**
 * A short-lived memory of heavy read-only results (Insights, the money
 * warnings, "Needs attention"), so that many people opening Home at once share
 * one computation instead of each building it (which, with years of data, took
 * the API's memory past its limit).
 *
 * Nothing goes stale: every successful change through the API (any POST, PUT,
 * PATCH or DELETE) moves the version on and drops everything, and an entry is
 * kept at most READ_CACHE_SECONDS (60) so date-based figures follow the clock.
 * Requests that arrive while a result is being worked out wait for that one.
 * READ_CACHE_SECONDS=0 turns it off (the tests do).
 */
@Injectable()
export class ReadCache {
  private version = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs = Math.max(0, Number(process.env.READ_CACHE_SECONDS ?? 60)) * 1000;

  /** Something changed: forget everything. */
  bump() {
    this.version += 1;
    this.entries.clear();
  }

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs === 0) return load();
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.version === this.version && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const entry: Entry = { version: this.version, at: now, value: load() };
    this.entries.set(key, entry);
    // A failure is not remembered: the next request tries again.
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.value as Promise<T>;
  }
}
