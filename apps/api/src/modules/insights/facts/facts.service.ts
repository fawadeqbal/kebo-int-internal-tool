import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Prisma } from "@kebo/database";
import { PrismaService, type Tx } from "../../../database/prisma.service";
import { Clock } from "../../../common/time/clock.service";
import { LimitsService } from "../../../common/company/limits.service";
import { CompanyContext, type CompanyInfo } from "../../../common/company/company-context";
import { toInfo } from "../../../common/company/companies.service";
import { factsCtxOf, inquiryFactsOf, orderFactsOf, type FactRow, type FactsCtx } from "./compute";

/** How a column is compared and written. */
type Kind = "text" | "date" | "num" | "int" | "bool" | "json";

interface TableSpec {
  table: "order_facts" | "inquiry_facts" | "factory_order_facts";
  key: string[];
  columns: Record<string, Kind>;
  /** Columns that move with the calendar alone (worked out against today): rewritten, never called a difference. */
  daily: string[];
}

const ORDER: TableSpec = {
  table: "order_facts",
  key: ["order_id"],
  columns: {
    order_id: "text",
    inquiry_id: "text",
    customer_id: "text",
    handled_by: "text",
    country: "text",
    channel: "text",
    category: "text",
    status: "text",
    stage: "text",
    ordered_on: "date",
    ship_by: "date",
    ready_on: "date",
    shipped_on: "date",
    delivered_on: "date",
    closed_on: "date",
    currency: "text",
    main_currency: "text",
    rate_known: "bool",
    total_main: "num",
    costed_main: "num",
    cost_main: "num",
    profit_quote_main: "num",
    profit_expected_main: "num",
    margin_quote: "num",
    margin: "num",
    expenses_main: "num",
    costs_over_plan_main: "num",
    received_main: "num",
    due_main: "num",
    overdue_main: "num",
    open_parts: "json",
    paid_in_full_on: "date",
    paid_on_time: "bool",
    on_time: "bool",
    days_quote_to_order: "int",
    days_to_ship: "int",
  },
  daily: ["overdue_main"],
};

const INQUIRY: TableSpec = {
  table: "inquiry_facts",
  key: ["inquiry_id"],
  columns: {
    inquiry_id: "text",
    customer_id: "text",
    handled_by: "text",
    channel: "text",
    country: "text",
    category: "text",
    stage: "text",
    received_on: "date",
    first_quote_on: "date",
    got_prices: "bool",
    quoted_value_main: "num",
    main_currency: "text",
    outcome: "text",
    lost_reason: "text",
    closed_on: "date",
    days_to_first_quote: "int",
    days_to_close: "int",
  },
  daily: [],
};

const FACTORY: TableSpec = {
  table: "factory_order_facts",
  key: ["order_id", "factory_id"],
  columns: {
    order_id: "text",
    factory_id: "text",
    status: "text",
    ordered_on: "date",
    currency: "text",
    owed: "num",
    paid: "num",
    to_pay: "num",
    main_currency: "text",
    owed_main: "num",
    paid_main: "num",
    to_pay_main: "num",
    open_parts: "json",
    ready_promised: "date",
    ready_actual: "date",
    days_late: "int",
    on_time: "bool",
    offers_sent: "int",
    offer_won: "bool",
    claims: "int",
  },
  daily: [],
};

/** One difference the nightly check found (and fixed). */
export interface FactDifference {
  table: string;
  key: string;
  /** missing: no row; extra: a row for something that is gone; changed: these columns differed. */
  kind: "missing" | "extra" | "changed";
  columns?: { column: string; stored: unknown; worked: unknown }[];
}

export interface RebuildReport {
  orders: number;
  inquiries: number;
  factoryRows: number;
  differences: FactDifference[];
}

/** Values compared the same way whether they come from the database or the rules. */
function norm(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case "num":
      return Number(v);
    case "int":
      return Number(v);
    case "bool":
      return Boolean(v);
    case "json":
      return stable(v);
    default:
      return String(v);
  }
}

/** JSON with its keys in one order (jsonb keeps its own), to compare. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);

const keyOf = (spec: TableSpec, r: Record<string, unknown>) => spec.key.map((k) => String(r[k])).join(":");
const BATCH = 200;
/** Long enough for a batch of orders on a busy day; waiting for another worker's batch, as long again. */
const TX = { timeout: 120_000, maxWait: 120_000 };

/**
 * Keeps the three calculated tables of Insights (order_facts, inquiry_facts, factory_order_facts) in step with
 * the data, through the shared rules only (compute.ts):
 * - database triggers queue every order or inquiry whose data changed (facts_queue); `drain` works them off —
 *   after every change through the API (a moment later), before every read of the tables, and in the worker;
 * - `rebuild` works out every row again, compares it with what is stored, logs and fixes each difference
 *   (the worker, every night; and on start when the tables are empty).
 * Work for one company never runs twice at once (a transaction-level advisory lock per company), so an older
 * result can never overwrite a newer one.
 */
@Injectable()
export class FactsService implements OnModuleDestroy {
  private readonly log = new Logger("Facts");
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
  ) {}

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private async ctx(db: PrismaService["db"] | Tx): Promise<FactsCtx> {
    return factsCtxOf(db, this.clock.timeZone, this.clock.today(), await this.limits.allows("expenses"));
  }

  /** Inside the company's lock: nothing else works on its tables meanwhile. */
  private locked<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const company = CompanyContext.require().id;
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`facts:${company}`}))`;
      return fn(tx as Tx);
    }, TX) as Promise<T>;
  }

  /** A change went through the API: work the queue off a moment later (several changes at once: once). */
  schedule(company: CompanyInfo, delayMs = 250) {
    const t = this.timers.get(company.id);
    if (t) clearTimeout(t);
    this.timers.set(
      company.id,
      setTimeout(() => {
        this.timers.delete(company.id);
        void CompanyContext.run(company, () => this.drain()).catch((e) => this.log.warn(`catching up for ${company.slug}: ${(e as Error).message}`));
      }, delayMs),
    );
  }

  /** What is still queued for the current company. */
  async pending(): Promise<number> {
    return this.prisma.db.factsQueue.count();
  }

  /**
   * Work the current company's queue off, `BATCH` entries at a time, until it is empty (or `maxBatches` are
   * done). An entry queued again while it was worked on stays for the next round. "all" (the rates moved):
   * everything is worked out again.
   */
  async drain(maxBatches = 50): Promise<{ done: number; left: number }> {
    let done = 0;
    for (let i = 0; i < maxBatches; i++) {
      if (!(await this.prisma.db.factsQueue.count({ take: 1 }))) break;
      if (await this.prisma.db.factsQueue.count({ where: { kind: "all" }, take: 1 })) {
        await this.rebuild(false);
        done += 1;
        continue;
      }
      const n = await this.locked(async (tx) => {
        const rows = await tx.$queryRaw<{ kind: string; entityId: string; seq: bigint }[]>`
          select kind, entity_id as "entityId", seq from facts_queue where kind <> 'all' order by seq limit ${BATCH}`;
        if (!rows.length) return 0;
        await this.refreshIn(
          tx,
          await this.ctx(tx),
          rows.filter((r) => r.kind === "order").map((r) => r.entityId),
          rows.filter((r) => r.kind === "inquiry").map((r) => r.entityId),
        );
        for (const r of rows) await tx.$executeRaw`delete from facts_queue where kind = ${r.kind} and entity_id = ${r.entityId}::uuid and seq = ${r.seq}`;
        return rows.length;
      });
      if (!n) break;
      done += n;
    }
    return { done, left: await this.pending() };
  }

  /** Work these orders out again now (and their order × factory rows). */
  async refreshOrders(ids: string[]) {
    await this.locked(async (tx) => this.refreshIn(tx, await this.ctx(tx), ids, []));
  }

  /** Work these inquiries out again now (and the orders made from them). */
  async refreshInquiries(ids: string[]) {
    await this.locked(async (tx) => this.refreshIn(tx, await this.ctx(tx), [], ids));
  }

  private async refreshIn(tx: Tx, ctx: FactsCtx, orderIds: string[], inquiryIds: string[]) {
    // An inquiry's channel, category, person and first quotation are its orders' too.
    const fromInquiries = inquiryIds.length
      ? (await tx.order.findMany({ where: { inquiryId: { in: inquiryIds } }, select: { id: true } })).map((o) => o.id)
      : [];
    const orders = [...new Set([...orderIds, ...fromInquiries])];
    for (let i = 0; i < orders.length; i += BATCH) {
      const ids = orders.slice(i, i + BATCH);
      const rows = await orderFactsOf(tx, ids, ctx);
      await this.sync(tx, ORDER, rows.orders, Prisma.sql`order_id = any(${ids}::uuid[])`);
      await this.sync(tx, FACTORY, rows.factories, Prisma.sql`order_id = any(${ids}::uuid[])`);
    }
    const inquiries = [...new Set(inquiryIds)];
    for (let i = 0; i < inquiries.length; i += BATCH) {
      const ids = inquiries.slice(i, i + BATCH);
      await this.sync(tx, INQUIRY, await inquiryFactsOf(tx, ids, ctx), Prisma.sql`inquiry_id = any(${ids}::uuid[])`);
    }
  }

  /**
   * Every row of the current company worked out again and compared with what is stored: each difference is
   * returned, logged (`log`) and fixed. A batch at a time, each under the company's lock; what was queued
   * before it began is covered and leaves the queue.
   */
  async rebuild(log = true): Promise<RebuildReport> {
    const db = this.prisma.db;
    const started = (await db.$queryRaw<{ seq: bigint | null }[]>`select max(seq) as seq from facts_queue`)[0]?.seq ?? null;
    const orderIds = (await db.order.findMany({ select: { id: true }, orderBy: [{ orderedOn: "asc" }, { id: "asc" }] })).map((o) => o.id);
    const inquiryIds = (await db.inquiry.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((i) => i.id);
    const differences: FactDifference[] = [];
    let factoryRows = 0;
    for (let i = 0; i < orderIds.length; i += BATCH) {
      const ids = orderIds.slice(i, i + BATCH);
      await this.locked(async (tx) => {
        const rows = await orderFactsOf(tx, ids, await this.ctx(tx));
        factoryRows += rows.factories.length;
        differences.push(...(await this.sync(tx, ORDER, rows.orders, Prisma.sql`order_id = any(${ids}::uuid[])`)));
        differences.push(...(await this.sync(tx, FACTORY, rows.factories, Prisma.sql`order_id = any(${ids}::uuid[])`)));
      });
    }
    for (let i = 0; i < inquiryIds.length; i += BATCH) {
      const ids = inquiryIds.slice(i, i + BATCH);
      await this.locked(async (tx) => {
        differences.push(...(await this.sync(tx, INQUIRY, await inquiryFactsOf(tx, ids, await this.ctx(tx)), Prisma.sql`inquiry_id = any(${ids}::uuid[])`)));
      });
    }
    await this.locked(async (tx) => {
      // Rows of inquiries no longer kept (deleted), and of orders gone: worked out again, or dropped.
      const strays = (await tx.$queryRaw<{ id: string }[]>`
        select inquiry_id as id from inquiry_facts where not (inquiry_id = any(${inquiryIds}::uuid[]))`).map((r) => r.id);
      if (strays.length) differences.push(...(await this.sync(tx, INQUIRY, await inquiryFactsOf(tx, strays, await this.ctx(tx)), Prisma.sql`inquiry_id = any(${strays}::uuid[])`)));
      const orphans = (await tx.$queryRaw<{ id: string }[]>`
        select order_id as id from order_facts where not (order_id = any(${orderIds}::uuid[]))
        union select order_id from factory_order_facts where not (order_id = any(${orderIds}::uuid[]))`).map((r) => r.id);
      if (orphans.length) {
        const rows = await orderFactsOf(tx, orphans, await this.ctx(tx));
        differences.push(...(await this.sync(tx, ORDER, rows.orders, Prisma.sql`order_id = any(${orphans}::uuid[])`)));
        differences.push(...(await this.sync(tx, FACTORY, rows.factories, Prisma.sql`order_id = any(${orphans}::uuid[])`)));
      }
      if (started !== null) await tx.$executeRaw`delete from facts_queue where seq <= ${started}`;
    });
    const report = { orders: orderIds.length, inquiries: inquiryIds.length, factoryRows, differences };
    if (log && differences.length) {
      const company = CompanyContext.require();
      const shown = differences.slice(0, 20).map((d) =>
        d.kind === "changed" ? `${d.table} ${d.key}: ${d.columns!.map((c) => `${c.column} ${JSON.stringify(c.stored)} → ${JSON.stringify(c.worked)}`).join(", ")}` : `${d.table} ${d.key}: ${d.kind}`,
      );
      this.log.warn(`${company.slug}: the nightly check fixed ${differences.length} difference(s): ${shown.join("; ")}${differences.length > 20 ? "; …" : ""}`);
    } else if (log) this.log.log(`${CompanyContext.require().slug}: the nightly check found the Insights tables right (${orderIds.length} orders, ${inquiryIds.length} inquiries)`);
    return report;
  }

  /**
   * Make the stored rows within `scope` exactly `rows`: insert what is missing, update what differs, delete
   * what has no row any more. Returns the differences (columns that only follow the calendar are rewritten
   * without counting as one).
   */
  private async sync(tx: Tx, spec: TableSpec, rows: FactRow[], scope: Prisma.Sql): Promise<FactDifference[]> {
    const stored = await tx.$queryRaw<{ r: Record<string, unknown> }[]>`select to_jsonb(t) as r from ${Prisma.raw(spec.table)} t where ${scope}`;
    const before = new Map(stored.map((s) => [keyOf(spec, s.r), s.r]));
    const cols = Object.keys(spec.columns);
    const differences: FactDifference[] = [];
    const write: FactRow[] = [];
    for (const row of rows) {
      const key = keyOf(spec, row);
      const old = before.get(key);
      before.delete(key);
      if (!old) {
        differences.push({ table: spec.table, key, kind: "missing" });
        write.push(row);
        continue;
      }
      const changed = cols.filter((c) => norm(spec.columns[c]!, old[c]) !== norm(spec.columns[c]!, row[c]));
      if (!changed.length) continue;
      write.push(row);
      const real = changed.filter((c) => !spec.daily.includes(c));
      if (real.length) differences.push({ table: spec.table, key, kind: "changed", columns: real.map((c) => ({ column: c, stored: old[c] ?? null, worked: row[c] ?? null })) });
    }
    for (const key of before.keys()) differences.push({ table: spec.table, key, kind: "extra" });
    if (before.size) {
      const gone = [...before.values()];
      if (spec.key.length === 1) {
        const k = spec.key[0]!;
        await tx.$executeRaw`delete from ${Prisma.raw(spec.table)} where ${Prisma.raw(k)} = any(${gone.map((g) => String(g[k]))}::uuid[])`;
      } else
        for (const g of gone)
          await tx.$executeRaw`delete from ${Prisma.raw(spec.table)} where ${Prisma.join(spec.key.map((k) => Prisma.sql`${Prisma.raw(k)} = ${String(g[k])}::uuid`), " and ")}`;
    }
    if (write.length) {
      const list = Prisma.raw(cols.join(", "));
      const updates = Prisma.raw([...cols.filter((c) => !spec.key.includes(c)).map((c) => `${c} = excluded.${c}`), "computed_at = now()"].join(", "));
      await tx.$executeRaw`
        insert into ${Prisma.raw(spec.table)} (${list})
        select ${list} from jsonb_populate_recordset(null::${Prisma.raw(spec.table)}, ${JSON.stringify(write)}::jsonb)
        on conflict (${Prisma.raw(spec.key.join(", "))}) do update set ${updates}`;
    }
    return differences;
  }

  /** On start: a company whose tables are empty while it has orders or inquiries (first start, a restore) is filled. */
  async fillIfEmpty(): Promise<boolean> {
    const db = this.prisma.db;
    const [orders, inquiries, facts] = await Promise.all([db.order.count({ take: 1 }), db.inquiry.count({ take: 1 }), db.inquiryFact.count({ take: 1 })]);
    const orderFacts = await db.orderFact.count({ take: 1 });
    if ((orders && !orderFacts) || (inquiries && !facts)) {
      const r = await this.rebuild(false);
      this.log.log(`${CompanyContext.require().slug}: filled the Insights tables (${r.orders} orders, ${r.inquiries} inquiries)`);
      return true;
    }
    return false;
  }

  /** Run `fn` inside every company that is not deleted, one at a time; a failure in one is logged and the rest go on. */
  async eachCompany(what: string, fn: () => Promise<unknown>) {
    const companies = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    for (const c of companies) await CompanyContext.run(toInfo(c), fn).catch((e) => this.log.error(`${what} for ${c.slug} failed: ${(e as Error).stack ?? e}`));
  }

  /** API and worker start: fill empty tables, then catch up on what was queued while nothing ran. */
  async onStart() {
    await this.eachCompany("filling the Insights tables", async () => {
      await this.fillIfEmpty();
      await this.drain();
    });
  }

  /** The worker's nightly check: everything worked out again, compared, differences logged and fixed. */
  async nightly() {
    await this.eachCompany("the nightly Insights check", () => this.rebuild(true));
  }
}
