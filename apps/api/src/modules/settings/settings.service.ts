import { Injectable } from "@nestjs/common";
import { readSettings, SETTINGS, type Settings, type SettingsKey } from "@kebo/shared";
import type { Prisma } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { requireReason } from "../../common/audit/reason";
import { CompanyContext } from "../../common/company/company-context";
import { DomainError } from "@kebo/utils";
import { LedgerPosting } from "../ledger/posting.service";
import { CompaniesService } from "../../common/company/companies.service";
import { ENV, type Env } from "../../config/env";
import { Inject } from "@nestjs/common";

const SETTING_LABEL = {
  exchangeRates: "exchange rates",
  defaultMarginPercent: "default margin",
  defaultDepositPercent: "default deposit",
  defaultBalanceTerms: "balance terms",
} as const;

const CACHE_MS = 30_000;

/** Typed settings with defaults filled in; read often, so cached briefly per process (per company). */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { at: number; value: Settings }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly ledger: LedgerPosting,
    private readonly companies: CompaniesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async get(): Promise<Settings> {
    const c = CompanyContext.require();
    const hit = this.cache.get(c.id);
    const value =
      hit && Date.now() - hit.at < CACHE_MS
        ? hit.value
        : readSettings(Object.fromEntries((await this.prisma.db.setting.findMany()).map((r) => [r.key, r.value])));
    if (!hit || hit.value !== value) this.cache.set(c.id, { at: Date.now(), value });
    // Time and dates live on the company itself (every request knows them): shown here as they are now.
    return { ...value, company: { ...value.company, timeZone: c.timeZone ?? this.env.APP_TIME_ZONE, dateFormat: c.dateFormat, timeFormat: c.timeFormat } };
  }

  /**
   * Whether the main currency can still change: only while no money is recorded
   * (orders, payments, factory payments, expenses), since those keep rates
   * against it. `locked` says why not, in plain words.
   */
  async mainCurrencyLock(): Promise<{ locked: boolean; reason: string | null }> {
    const db = this.prisma.db;
    const [orders, payments, factoryPayments, expenses] = await Promise.all([
      db.order.count({ take: 1 }),
      db.moneyMovement.count({ take: 1 }),
      db.allocation.count({ where: { target: "purchase" }, take: 1 }),
      db.expense.count({ take: 1 }),
    ]);
    const has = [orders && "orders", payments && "payments", factoryPayments && "supplier payments", expenses && "expenses"].filter(
      (x): x is string => !!x,
    );
    if (!has.length) return { locked: false, reason: null };
    const list = has.length === 1 ? has[0] : `${has.slice(0, -1).join(", ")} and ${has[has.length - 1]}`;
    return {
      locked: true,
      reason: `The main currency cannot change any more: ${list} are already recorded with rates against it. You can still change the exchange rates.`,
    };
  }

  private async checkMainCurrency(before: string, after: string) {
    if (before === after) return;
    const lock = await this.mainCurrencyLock();
    if (lock.locked) throw new DomainError(lock.reason!);
  }

  /**
   * Saves one group. Exchange rates, the default margin and the payment
   * defaults change every new price and quotation, so changing them says why
   * (sent as `reason` next to the settings).
   */
  async update<K extends SettingsKey>(user: SessionUser, key: K, input: unknown): Promise<Settings[K]> {
    const { reason: given, ...rest } = (input && typeof input === "object" ? input : {}) as { reason?: unknown };
    const value = SETTINGS[key].parse(input && typeof input === "object" ? rest : input) as Settings[K];
    const before = (await this.get())[key];
    if (key === "sales") await this.checkMainCurrency((before as Settings["sales"]).currency, (value as Settings["sales"]).currency);
    const watched =
      key === "sales" ? (["exchangeRates", "defaultMarginPercent", "defaultDepositPercent", "defaultBalanceTerms"] as const) : [];
    const changed = watched.filter(
      (f) => JSON.stringify((before as Record<string, unknown>)[f]) !== JSON.stringify((value as Record<string, unknown>)[f]),
    );
    // The date each exchange rate was last changed (kept here, whatever the form sent).
    if (key === "sales") {
      const b = before as Settings["sales"];
      const v = value as Settings["sales"];
      const today = this.clock.today();
      v.rateDates = Object.fromEntries(
        Object.entries(v.exchangeRates).flatMap(([c, r]) => {
          const was = b.exchangeRates?.[c];
          const date = was === r ? b.rateDates?.[c] : today;
          return date ? [[c, date]] : [];
        }),
      );
    }
    const reason = changed.length
      ? requireReason(typeof given === "string" ? given.slice(0, 500) : null, "settings", "money settings change")
      : typeof given === "string"
        ? given.slice(0, 500)
        : null;
    // Time and dates are kept on the company (the one place every request and job reads them), not in the JSON.
    let stored: unknown = value;
    if (key === "company") {
      const { timeZone, dateFormat, timeFormat, ...rest } = value as Settings["company"];
      stored = rest;
      const c = CompanyContext.require();
      const zone = timeZone || this.env.APP_TIME_ZONE;
      if (zone !== (c.timeZone ?? this.env.APP_TIME_ZONE) || dateFormat !== c.dateFormat || timeFormat !== c.timeFormat) {
        await this.prisma.platform.company.update({ where: { id: c.id }, data: { timeZone: zone, dateFormat, timeFormat } });
        this.companies.forget(c.id);
        // This request goes on in the new time at once.
        CompanyContext.set({ ...c, timeZone: zone, dateFormat, timeFormat });
      }
    }
    await this.prisma.tx(async (tx) => {
      await tx.setting.upsert({
        where: { companyId_key: { companyId: user.companyId, key } },
        create: { key, value: stored as Prisma.InputJsonValue },
        update: { value: stored as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "settings",
        summary: `Changed ${key} settings${changed.length ? ` (${changed.map((f) => SETTING_LABEL[f]).join(", ")})` : ""}`,
        oldValues: before as never,
        newValues: value as never,
        reason,
      });
      // What a factory bears in another currency is taken off at today's rate (factoryPosition): the ledger follows.
      if (changed.includes("exchangeRates" as never)) {
        const borne = await tx.expense.findMany({ where: { borneBy: "factory", voidedAt: null, orderId: { not: null } }, select: { id: true } });
        await this.ledger.post(tx, borne.map((e) => ({ type: "expense" as const, id: e.id })), { userId: user.id, reason: reason ?? "Exchange rates changed" });
      }
    });
    this.cache.delete(user.companyId);
    return value;
  }
}
