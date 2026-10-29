/**
 * The open company connections, at most `max` companies at once: the least
 * recently used one is closed to make room, and any not used for `idleMs` is
 * closed by sweep(). Each company's connection is a pool of a few database
 * connections, so this caps what one process can hold (max × pool size) well
 * under the database's max_connections, however many companies are busy.
 *
 * A closed one is not cut off at once: it is closed after `graceMs`, so a
 * request still using it finishes; asked for again before then, it is reused.
 */
export class CompanyPools<T> {
  /** In use order: the first is the least recently used (a Map keeps insertion order). */
  private readonly open = new Map<string, { client: T; usedAt: number }>();
  private readonly closing = new Map<string, { client: T; timer: NodeJS.Timeout }>();

  constructor(
    private readonly opts: {
      max: number;
      idleMs: number;
      graceMs: number;
      create: (companyId: string) => T;
      close: (client: T, companyId: string) => Promise<void>;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  get size() {
    return this.open.size;
  }

  /** Companies with an open connection, least recently used first. */
  ids() {
    return [...this.open.keys()];
  }

  get(companyId: string): T {
    const hit = this.open.get(companyId);
    if (hit) {
      // Most recently used goes last.
      this.open.delete(companyId);
      hit.usedAt = this.now();
      this.open.set(companyId, hit);
      return hit.client;
    }
    const back = this.closing.get(companyId);
    if (back) clearTimeout(back.timer);
    this.closing.delete(companyId);
    const client = back?.client ?? this.opts.create(companyId);
    this.open.set(companyId, { client, usedAt: this.now() });
    while (this.open.size > this.opts.max) {
      const [oldest] = this.open.keys();
      this.retire(oldest!);
    }
    return client;
  }

  /** Close (after the grace time) the connections of companies idle for idleMs. */
  sweep() {
    const now = this.now();
    for (const [id, c] of this.open) if (now - c.usedAt >= this.opts.idleMs) this.retire(id);
  }

  /** A company is gone: close its connection now. */
  async forget(companyId: string) {
    const hit = this.open.get(companyId) ?? this.closing.get(companyId);
    this.open.delete(companyId);
    const pending = this.closing.get(companyId);
    if (pending) clearTimeout(pending.timer);
    this.closing.delete(companyId);
    if (hit) await this.opts.close(hit.client, companyId);
  }

  /** Close everything now (shutting down). */
  async closeAll() {
    const all = [...this.open.entries()].map(([id, c]) => [id, c.client] as const);
    for (const [id, c] of this.closing) {
      clearTimeout(c.timer);
      all.push([id, c.client]);
    }
    this.open.clear();
    this.closing.clear();
    await Promise.all(all.map(([id, c]) => this.opts.close(c, id)));
  }

  private retire(companyId: string) {
    const c = this.open.get(companyId);
    if (!c) return;
    this.open.delete(companyId);
    const timer = setTimeout(() => {
      this.closing.delete(companyId);
      void this.opts.close(c.client, companyId);
    }, this.opts.graceMs);
    timer.unref();
    this.closing.set(companyId, { client: c.client, timer });
  }
}
