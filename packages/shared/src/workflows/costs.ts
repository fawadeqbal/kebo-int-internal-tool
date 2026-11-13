import type { BasisStep, ExpenseBearer, ExpenseCategory } from "../enums";
import { EXPENSE_CATEGORY_LABEL } from "../labels";
import { BASIS_STEP_LABEL } from "./basis";
import type { FlowStep } from "./flow";

/**
 * Costs on an order (order flow v3, step "Costs"): what the quote planned to
 * reach the price basis (order_costs) against what was spent (expenses).
 *
 * Nothing here touches the database: the API and the web share it.
 */

/** The planned cost an expense of this kind pays for first (freight against the planned freight…). */
export const BASIS_STEP_OF_CATEGORY: Partial<Record<ExpenseCategory, BasisStep>> = {
  inland_transport: "to_port",
  freight: "freight",
  insurance: "insurance",
  customs: "duties",
};

export const EXPENSE_BEARER_LABEL: Record<ExpenseBearer, string> = {
  us: "Us",
  customer: "The customer",
  factory: "The factory",
};

/** The line under each choice on the expense form. */
export const EXPENSE_BEARER_HINT: Record<ExpenseBearer, string> = {
  us: "cuts the order's profit",
  customer: "added to what they owe",
  factory: "taken off what we owe them",
};

/** The kinds the order's expense form offers first, as chips (the rest stay under "Other"). */
export const ORDER_EXPENSE_CHIPS: readonly ExpenseCategory[] = [
  "freight",
  "inland_transport",
  "inspection",
  "customs",
  "insurance",
  "bank_charges",
  "travel",
  "hotel",
  "meals",
  "courier",
  "commission",
  "other",
];

/** Short names for the chips and tables ("To the port" for inland transport). */
export const ORDER_EXPENSE_SHORT: Partial<Record<ExpenseCategory, string>> = {
  freight: "Freight",
  inland_transport: "To the port",
  customs: "Customs",
  bank_charges: "Bank charges",
  travel: "Travel",
  hotel: "Hotel",
  meals: "Meals",
};

export const expenseShort = (c: ExpenseCategory) => ORDER_EXPENSE_SHORT[c] ?? EXPENSE_CATEGORY_LABEL[c] ?? c;

/** The step an expense of this kind usually belongs to, when nothing else says (freight → Shipping, inspection → Production). */
export const STEP_OF_CATEGORY: Partial<Record<ExpenseCategory, FlowStep>> = {
  freight: "shipping",
  inland_transport: "shipping",
  insurance: "shipping",
  customs: "delivery",
  inspection: "production",
  bank_charges: "payment",
  courier: "documents",
};

/** Groups of the rows in "Planned and spent" that the quote did not plan for. */
const GROUP_OF: Partial<Record<ExpenseCategory, string>> = { travel: "travel", hotel: "travel" };
const GROUP_LABEL: Record<string, string> = { travel: "Travel and hotel" };

export type CostRowStatus = "not_spent" | "within" | "spent" | "over" | "not_planned";

export const COST_ROW_STATUS_LABEL: Record<CostRowStatus, string> = {
  not_spent: "Not spent yet",
  within: "Within the plan",
  spent: "As planned",
  over: "Over the plan",
  not_planned: "Not planned",
};

export interface CostRow {
  key: string;
  label: string;
  /** The planned step, when it was on the quote. */
  basisStep: BasisStep | null;
  categories: ExpenseCategory[];
  /** In minor units of the order's currency; null when not planned. */
  plannedMinor: number | null;
  spentMinor: number;
  /** Planned − spent (positive: left; negative: over). */
  differenceMinor: number;
  status: CostRowStatus;
  note: string | null;
}

/**
 * "Planned and spent": each cost the quote planned (to the port, freight…)
 * against the expenses of its kinds borne by us, then the kinds nobody planned.
 * `covered` is what the plan paid for: the planned kinds together, up to the
 * whole plan; everything else spent is "not planned" and cuts the profit.
 */
export function plannedAndSpent(
  planned: { step: BasisStep; costMinor: number; note?: string | null }[],
  spent: { category: ExpenseCategory; minor: number }[],
) {
  const byStep = new Map<BasisStep, number>();
  const byCategory = new Map<ExpenseCategory, number>();
  for (const e of spent) {
    const step = BASIS_STEP_OF_CATEGORY[e.category];
    if (step && planned.some((p) => p.step === step)) byStep.set(step, (byStep.get(step) ?? 0) + e.minor);
    else byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.minor);
  }
  const rows: CostRow[] = [];
  let plannedMinor = 0;
  for (const p of planned) {
    const s = byStep.get(p.step) ?? 0;
    plannedMinor += p.costMinor;
    const diff = p.costMinor - s;
    rows.push({
      key: `plan:${p.step}`,
      label: BASIS_STEP_LABEL[p.step],
      basisStep: p.step,
      categories: (Object.keys(BASIS_STEP_OF_CATEGORY) as ExpenseCategory[]).filter((c) => BASIS_STEP_OF_CATEGORY[c] === p.step),
      plannedMinor: p.costMinor,
      spentMinor: s,
      differenceMinor: diff,
      status: s === 0 ? "not_spent" : diff > 0 ? "within" : diff === 0 ? "spent" : "over",
      note: p.note ?? null,
    });
  }
  const groups = new Map<string, { categories: ExpenseCategory[]; minor: number }>();
  for (const [c, minor] of byCategory) {
    const g = GROUP_OF[c] ?? c;
    const cur = groups.get(g) ?? { categories: [], minor: 0 };
    cur.categories.push(c);
    cur.minor += minor;
    groups.set(g, cur);
  }
  for (const [g, v] of [...groups].sort((a, b) => b[1].minor - a[1].minor)) {
    if (v.minor === 0) continue;
    rows.push({
      key: `other:${g}`,
      label: GROUP_LABEL[g] ?? (v.categories.length === 1 ? expenseShort(v.categories[0]!) : g),
      basisStep: null,
      categories: v.categories,
      plannedMinor: null,
      spentMinor: v.minor,
      differenceMinor: -v.minor,
      status: "not_planned",
      note: null,
    });
  }
  // As everywhere money is read (order, profit & loss, Insights): freight, transport, insurance and customs
  // pay for the planned costs together, up to what was planned in all; beyond that they are a cost of their own.
  const spentMinor = spent.reduce((t, e) => t + e.minor, 0);
  const basisSpent = spent.filter((e) => BASIS_STEP_OF_CATEGORY[e.category]).reduce((t, e) => t + e.minor, 0);
  const coveredMinor = Math.min(Math.max(plannedMinor, 0), Math.max(basisSpent, 0));
  return { rows, plannedMinor, spentMinor, coveredMinor, notPlannedMinor: spentMinor - coveredMinor };
}
