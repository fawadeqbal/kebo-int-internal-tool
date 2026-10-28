import { Injectable } from "@nestjs/common";
import { CompanyContext } from "../company/company-context";

type Entry = { version: number; at: number; value: Promise<unknown> };

/**
 * A short-lived memory of heavy read-only results (Insights, the money
 * warnings, "Needs attention"), so that many people opening Home at once share
 * one computation instead of each building it (which, with years of data, took
 * the API's memory past its limit).
 *
 * Per company: keys are kept apart by company, and a change in one company
 * forgets only that company's results.
 *
 * Nothing goes stale: every successful change through the API (any POST, PUT,
 * PATCH or DELETE) moves the company's version on and drops its entries, and an
 * entry is kept at most READ_CACHE_SECONDS (60) so date-based figures follow the
 * clock. Requests that arrive while a result is being worked out wait for that
 * one. READ_CACHE_SECONDS=0 turns it off (the tests do).
 */
@Injectable()
export class ReadCache {
  private readonly versions = new Map<string, number>();
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs = Math.max(0, Number(process.env.READ_CACHE_SECONDS ?? 60)) * 1000;

  /** Something changed in this company (the current one by default): forget its results. */
  bump(companyId = CompanyContext.require().id) {
    this.versions.set(companyId, (this.versions.get(companyId) ?? 0) + 1);
    const prefix = `${companyId}:`;
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs === 0) return load();
    const company = CompanyContext.require().id;
    const full = `${company}:${key}`;
    const version = this.versions.get(company) ?? 0;
    const now = Date.now();
    const hit = this.entries.get(full);
    if (hit && hit.version === version && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    if (this.entries.size > 5_000) this.entries.clear();
    const entry: Entry = { version, at: now, value: load() };
    this.entries.set(full, entry);
    // A failure is not remembered: the next request tries again.
    entry.value.catch(() => {
      if (this.entries.get(full) === entry) this.entries.delete(full);
    });
    return entry.value as Promise<T>;
  }
}
