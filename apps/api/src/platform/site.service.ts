import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { channelOf, DEFAULT_SITE, siteContent, type LeadOrigin, type SiteContent } from "@kebo/shared";
import { addDays, todayIn, type ISODate } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { PlatformCompaniesService } from "./companies.platform";
import type { PlatformAdminUser } from "./platform-auth";

type Actor = Pick<PlatformAdminUser, "id" | "name">;

const KEY = "marketing";
const CACHE_MS = 30_000;
/** Crawlers and link previews: not visitors. */
const BOT =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios|headless|lighthouse|monitor/i;

/** A saved page that no longer fits the rules (a field added later): the defaults fill what is missing. */
function readable(v: unknown): SiteContent {
  const merged = { ...DEFAULT_SITE, ...(v && typeof v === "object" ? (v as object) : {}) };
  const ok = siteContent.safeParse(merged);
  return ok.success ? ok.data : DEFAULT_SITE;
}

/**
 * The marketing site (get.<BASE_DOMAIN>): its words, edited as a draft in the
 * platform panel and published when ready; the plans shown with them; and the
 * visits, counted per day and channel without cookies.
 */
@Injectable()
export class SiteService {
  private cache: { at: number; value: Promise<Awaited<ReturnType<SiteService["load"]>>> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: PlatformCompaniesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  private today(): ISODate {
    return todayIn(this.env.APP_TIME_ZONE);
  }

  /* ---------------------------------------------------------------- the page */

  /** The plans as the page shows them (active ones, cheapest first; those the page leaves out are marked). */
  private async plans() {
    const rows = await this.db.plan.findMany({ where: { isActive: true }, orderBy: [{ priceMinor: "asc" }, { name: "asc" }] });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.priceMinor / 100,
      currency: p.currency,
      period: p.period,
      maxUsers: p.maxUsers,
      maxStorageMb: p.maxStorageMb,
      features: p.features,
    }));
  }

  private async load() {
    const [row, plans] = await Promise.all([this.db.siteContent.findUnique({ where: { key: KEY } }), this.plans()]);
    const content = readable(row?.published ?? null);
    return { content, plans: content.plans.show ? plans.filter((p) => !content.plans.hidden.includes(p.id)) : [] };
  }

  /** What visitors see (remembered for a few seconds). */
  published() {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const value = this.load();
      value.catch(() => (this.cache = null));
      this.cache = { at: Date.now(), value };
    }
    return this.cache.value;
  }

  /** For the editor: the draft, what is live, and every active plan (to choose which show). */
  async editor() {
    const [row, plans] = await Promise.all([this.db.siteContent.findUnique({ where: { key: KEY } }), this.plans()]);
    const published = row?.published ? readable(row.published) : null;
    const draft = row ? readable(row.draft) : DEFAULT_SITE;
    return {
      draft,
      published,
      publishedAt: row?.publishedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
      /** The draft differs from what visitors see. */
      unpublished: JSON.stringify(draft) !== JSON.stringify(published ?? DEFAULT_SITE),
      plans,
    };
  }

  async saveDraft(actor: Actor, draft: SiteContent) {
    const value = draft as unknown as Prisma.InputJsonValue;
    await this.db.siteContent.upsert({
      where: { key: KEY },
      create: { key: KEY, draft: value, updatedBy: actor.name },
      update: { draft: value, updatedBy: actor.name },
    });
    return this.editor();
  }

  /** The draft goes live. */
  async publish(actor: Actor) {
    const row = await this.db.siteContent.findUnique({ where: { key: KEY } });
    const draft = (row ? readable(row.draft) : DEFAULT_SITE) as unknown as Prisma.InputJsonValue;
    await this.db.siteContent.upsert({
      where: { key: KEY },
      create: { key: KEY, draft, published: draft, publishedAt: new Date(), updatedBy: actor.name },
      update: { published: draft, publishedAt: new Date(), updatedBy: actor.name },
    });
    this.cache = null;
    await this.companies.log(actor, "site", "Published the marketing page");
    return this.editor();
  }

  /** Back to what visitors see (throw the draft away). */
  async discard(actor: Actor) {
    const row = await this.db.siteContent.findUnique({ where: { key: KEY } });
    const live = (row?.published ? readable(row.published) : DEFAULT_SITE) as unknown as Prisma.InputJsonValue;
    await this.db.siteContent.upsert({
      where: { key: KEY },
      create: { key: KEY, draft: live, updatedBy: actor.name },
      update: { draft: live, updatedBy: actor.name },
    });
    return this.editor();
  }

  /* ---------------------------------------------------------------- visits */

  /**
   * One page view: counted per day and channel; each visitor once a day, told
   * apart by a one-way hash of the day, their address and browser (nothing
   * stored on their device, and the hashes are gone after two days).
   */
  async visit(input: { ip: string; userAgent: string | null | undefined; origin: LeadOrigin | null }) {
    const ua = input.userAgent ?? "";
    if (!ua || BOT.test(ua)) return { counted: false };
    const day = this.today();
    const channel = channelOf(input.origin);
    const hash = createHash("sha256").update(`${day}|${input.ip}|${ua}|${this.env.AUTH_SECRET}`).digest("hex").slice(0, 32);
    const fresh = await this.db
      .$executeRaw`insert into site_visitor_marks (day, hash) values (${day}::date, ${hash}) on conflict do nothing`;
    await this.db.$executeRaw`
      insert into site_visits (day, channel, views, visitors) values (${day}::date, ${channel}, 1, ${fresh ? 1 : 0})
      on conflict (day, channel) do update set views = site_visits.views + 1, visitors = site_visits.visitors + ${fresh ? 1 : 0}`;
    // Now and then: forget the marks of earlier days.
    if (Math.random() < 0.02) await this.db.siteVisitorMark.deleteMany({ where: { day: { lt: toDbDate(addDays(day, -1)) } } });
    return { counted: true };
  }

  /* ---------------------------------------------------------------- numbers */

  /**
   * The marketing numbers for a month and the one before: visitors, leads, and
   * how far those leads got (a demo or trial, a paying client), with leads and
   * visitors per channel.
   */
  async numbers(month?: string) {
    const today = this.today();
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
    const range = (ym: string) => {
      const [y, mo] = ym.split("-").map(Number) as [number, number];
      const from = `${ym}-01` as ISODate;
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return { from, to: `${ym}-${String(last).padStart(2, "0")}` as ISODate };
    };
    const before = (() => {
      const [y, mo] = m.split("-").map(Number) as [number, number];
      const d = new Date(Date.UTC(y, mo - 2, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    })();
    const figures = async (ym: string) => {
      const r = range(ym);
      const start = new Date(`${r.from}T00:00:00Z`);
      const end = new Date(`${addDays(r.to, 1)}T00:00:00Z`);
      const [visits, leads] = await Promise.all([
        this.db.siteVisit.groupBy({
          by: ["channel"],
          where: { day: { gte: toDbDate(r.from), lte: toDbDate(r.to) } },
          _sum: { views: true, visitors: true },
        }),
        this.db.lead.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: start, lt: end } }, _count: true }),
      ]);
      const channels = new Map<
        string,
        { channel: string; visitors: number; views: number; leads: number; demos: number; clients: number }
      >();
      const row = (c: string | null) => {
        const k = c ?? "direct";
        if (!channels.has(k)) channels.set(k, { channel: k, visitors: 0, views: 0, leads: 0, demos: 0, clients: 0 });
        return channels.get(k)!;
      };
      for (const v of visits) {
        const r2 = row(v.channel);
        r2.visitors += v._sum.visitors ?? 0;
        r2.views += v._sum.views ?? 0;
      }
      for (const l of leads) {
        const r2 = row(l.channel);
        r2.leads += l._count;
        if (l.status === "demo" || l.status === "client") r2.demos += l._count;
        if (l.status === "client") r2.clients += l._count;
      }
      const all = [...channels.values()].sort((a, b) => b.leads - a.leads || b.visitors - a.visitors);
      const sum = (k: "visitors" | "views" | "leads" | "demos" | "clients") => all.reduce((n, c) => n + c[k], 0);
      return {
        month: ym,
        ...r,
        visitors: sum("visitors"),
        views: sum("views"),
        leads: sum("leads"),
        demos: sum("demos"),
        clients: sum("clients"),
        channels: all,
      };
    };
    const [now, prev, daily] = await Promise.all([
      figures(m),
      figures(before),
      this.db.siteVisit.groupBy({
        by: ["day"],
        where: { day: { gte: toDbDate(addDays(today, -29)) } },
        _sum: { visitors: true },
        orderBy: { day: "asc" },
      }),
    ]);
    // Every one of the last 30 days, the quiet ones as 0.
    const seen = new Map(daily.map((d) => [fromDbDate(d.day), d._sum.visitors ?? 0]));
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const day = addDays(today, i - 29);
      return { day, visitors: seen.get(day) ?? 0 };
    });
    return { now, before: prev, last30 };
  }
}
