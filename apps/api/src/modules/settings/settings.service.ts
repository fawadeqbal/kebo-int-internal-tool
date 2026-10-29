import { Injectable } from "@nestjs/common";
import { readSettings, SETTINGS, type Settings, type SettingsKey } from "@kebo/shared";
import type { Prisma } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";
import { requireReason } from "../../common/audit/reason";
import { CompanyContext } from "../../common/company/company-context";
import { DomainError } from "@kebo/utils";

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
  ) {}

  async get(): Promise<Settings> {
    const company = CompanyContext.require().id;
    const hit = this.cache.get(company);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const rows = await this.prisma.db.setting.findMany();
    const value = readSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    this.cache.set(company, { at: Date.now(), value });
    return value;
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
      db.payment.count({ take: 1 }),
      db.factoryPayment.count({ take: 1 }),
      db.expense.count({ take: 1 }),
    ]);
    const has = [orders && "orders", payments && "payments", factoryPayments && "factory payments", expenses && "expenses"].filter(
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
    const reason = changed.length
      ? requireReason(typeof given === "string" ? given.slice(0, 500) : null, "settings", "money settings change")
      : typeof given === "string"
        ? given.slice(0, 500)
        : null;
    await this.prisma.tx(async (tx) => {
      await tx.setting.upsert({
        where: { companyId_key: { companyId: user.companyId, key } },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
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
    });
    this.cache.delete(user.companyId);
    return value;
  }
}
