import { decimalToMinor, livePart, livePurchase, type Prisma } from "@kebo/database";
import { expenseIn, supplierPosition, orderPosition, orderRate, type SupplierOwing, type Fx, type Minor, type OrderPosition } from "@kebo/money";
import type { Settings } from "@kebo/shared";

/**
 * The one way an order's position with its customer (and with its suppliers)
 * is read from the database: every screen, paper, reminder and report loads
 * these relations and calls positionOf / supplierPositionOf, so "still due",
 * the deposit and "still to pay a factory" are the same number everywhere.
 * The SQL helpers in due.ts follow the same rules.
 */

type Decimalish = Prisma.Decimal | { toString(): string } | number | string;

/**
 * What the money rules need besides the order: Settings' main currency and
 * rates, and whether the company has the expenses module. Expenses are a plan
 * feature: without it nothing counts as charged to the customer or borne by a
 * supplier (as the order's money always showed), on every screen and in SQL.
 */
export interface MoneyCtx extends Fx {
  expensesOn: boolean;
}

export const fxOf = (s: Pick<Settings, "sales">, expensesOn: boolean): MoneyCtx => ({ main: s.sales.currency, rates: s.sales.exchangeRates, expensesOn });

/** The expenses charged to the customer (added to what they owe), to load with an order. */
export const chargedExpenses = {
  where: { voidedAt: null, borneBy: "customer" },
  select: { amount: true, currency: true, rate: true, borneBy: true, voidedAt: true, description: true, spentOn: true, id: true },
} satisfies Prisma.Order$expensesArgs;

/** The relations positionOf reads (what pays the order, and the plan, as most screens load them). */
export const positionRelations = {
  allocations: { where: livePart, select: { amount: true, bankCharges: true, voidedAt: true } },
  receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
  expenses: chargedExpenses,
} satisfies Prisma.OrderInclude;

export interface PositionFacts {
  total: Decimalish;
  currency: string;
  depositPercent: Decimalish;
  mainCurrency: string | null;
  mainRate: Decimalish | null;
  /** What pays it (its live allocations; removed ones are left out). */
  allocations: { amount: Decimalish; bankCharges: Decimalish; voidedAt?: Date | null }[];
  receivables: { amount: Decimalish; part: string | null }[];
  /** At least the expenses charged to the customer (others are left out here). */
  expenses: { amount: Decimalish; currency: string; rate: Decimalish; borneBy?: string; voidedAt?: Date | null }[];
}

const minor = (d: Decimalish) => decimalToMinor(d as Prisma.Decimal);

/** Each expense charged to the customer in the order's currency (null: no rate to turn it); none without the expenses module. */
export function chargedOf<E extends PositionFacts["expenses"][number]>(
  o: { currency: string; mainCurrency: string | null; mainRate: Decimalish | null; expenses: E[] },
  fx: MoneyCtx,
) {
  if (!fx.expensesOn) return [];
  const perMain = orderRate({ currency: o.currency, mainCurrency: o.mainCurrency, mainRate: o.mainRate as never }, fx.main, fx.rates);
  return o.expenses
    .filter((e) => (e.borneBy ?? "customer") === "customer" && !e.voidedAt)
    .map((e) => ({ expense: e, minor: expenseIn({ amountMinor: minor(e.amount), currency: e.currency, rate: e.rate.toString() }, o.currency, perMain) }));
}

/** Where the order stands with the customer (see orderPosition in @kebo/money). */
export function positionOf(o: PositionFacts, fx: MoneyCtx, toleranceMinor = 0): OrderPosition {
  const charged = chargedOf(o, fx).reduce((t, c) => t + (c.minor ?? 0), 0);
  return orderPosition({
    totalMinor: minor(o.total),
    payments: o.allocations
      .filter((p) => !p.voidedAt)
      .map((p) => ({ amountMinor: minor(p.amount), bankChargesMinor: minor(p.bankCharges) })),
    plan: o.receivables.map((p) => ({ amountMinor: minor(p.amount), part: p.part })),
    depositPercent: Number(o.depositPercent.toString()),
    chargedMinor: charged,
    toleranceMinor,
  });
}

/** The shared order rules' money facts (stage warnings, what the order needs) from a position. */
export const moneyFacts = (p: OrderPosition) => ({
  totalMinor: p.totalMinor,
  receivedMinor: p.settledMinor,
  depositPercent: p.depositPercent,
  chargedMinor: p.chargedMinor,
  depositMinor: p.depositMinor,
});

/** What an order paid its suppliers, as supplierPositionOf reads it (live parts, in the supplier's currency). */
export const supplierPaidRelation = {
  where: livePurchase,
  orderBy: [{ on: "asc" }, { createdAt: "asc" }],
  // id: which payment paid which part of a supplier's plan (supplier-plan.ts).
  select: { id: true, share: true, voidedAt: true, movement: { select: { partyId: true, currency: true, rate: true } } },
} satisfies Prisma.Order$supplierPaidArgs;

/** The expenses the suppliers bear, to load with an order. */
export const supplierBorneExpenses = {
  where: { voidedAt: null, borneBy: "factory", supplierId: { not: null } },
  select: { amount: true, currency: true, rate: true, supplierId: true, borneBy: true, voidedAt: true, description: true, spentOn: true },
} satisfies Prisma.Order$expensesArgs;

export interface SupplierFacts {
  lines: {
    supplierId: string | null;
    supplierUnitPrice: Decimalish | null;
    supplierCurrency: string | null;
    supplierTaxRate: Decimalish | null;
    supplierTaxIncluded: boolean;
    quantity: Decimalish;
  }[];
  /** What we paid its suppliers: each payment's part (what was paid, in the supplier's currency) and its entry. */
  supplierPaid: { share: Decimalish; voidedAt?: Date | null; movement: { partyId: string | null; currency: string } }[];
  /** At least the expenses the suppliers bear (others are left out here). */
  expenses: { amount: Decimalish; currency: string; rate: Decimalish; supplierId: string | null; borneBy?: string; voidedAt?: Date | null }[];
}

/** What we owe each supplier on the order and where it stands (see supplierPosition in @kebo/money). */
export function supplierPositionOf(o: SupplierFacts, fx: MoneyCtx): SupplierOwing[] {
  return supplierPosition(
    o.lines.flatMap((l) =>
      l.supplierId && l.supplierUnitPrice !== null && l.supplierCurrency
        ? [
            {
              supplierId: l.supplierId,
              currency: l.supplierCurrency,
              unitPriceMinor: minor(l.supplierUnitPrice),
              taxRate: l.supplierTaxRate?.toString() ?? 0,
              taxIncluded: l.supplierTaxIncluded,
              quantity: l.quantity.toString(),
            },
          ]
        : [],
    ),
    o.supplierPaid
      .filter((p) => !p.voidedAt)
      .map((p) => ({ supplierId: p.movement.partyId!, currency: p.movement.currency, amountMinor: minor(p.share) })),
    o.expenses
      .filter((e) => fx.expensesOn && (e.borneBy ?? "factory") === "factory" && !e.voidedAt && e.supplierId)
      .map((e) => ({ supplierId: e.supplierId!, currency: e.currency, amountMinor: minor(e.amount), rate: e.rate.toString() })),
    fx,
  );
}

export type { SupplierOwing, Fx, Minor, OrderPosition };
