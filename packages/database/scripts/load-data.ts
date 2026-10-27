/**
 * Load data: years of realistic history on top of the demo seed, for load
 * tests and checking that pages stay fast with a big company's data. For
 * development only — refused against a non-local database.
 *
 *   pnpm db:load-data                 10,000 deals over three years
 *   pnpm db:load-data --deals 30000   more
 *
 * Deals go through the same shape the app makes: items, factory offers,
 * quotation revisions, and for won deals an order with its plan, payments
 * in and out, expenses and stage history. Plus company expenses every month,
 * notifications and an audit trail.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { documentTotals, fromMinor, priceForMargin, splitDeposit, toMinor, withTaxMinor } from "@kebo/money";
import { defaultPlan, type OrderStage } from "@kebo/shared";
import { addDays, todayIn } from "@kebo/utils";
import { createPrismaClient, nextReference, toDbDate } from "../src";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "db", "postgres"].includes(host)) throw new Error(`Refusing to load test data into ${host}: local databases only.`);
const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const DEALS = arg("deals", 10_000);
const WORKERS = arg("workers", 8);
const db = createPrismaClient({ url });
const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
const today = todayIn(tz);

// A fixed seed, so two runs make the same data.
let seed = 42;
const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const COUNTRIES = ["PK", "NG", "AE", "KE", "SA", "EG", "BD", "TZ", "GH", "IQ", "OM", "QA", "ET", "UZ", "KZ"];
const CATEGORIES = ["Machinery", "Packaging", "Building materials", "Chemicals", "Valves", "Electrical", "Textiles", "Food processing"];
const PRODUCTS: [string, string, number, number][] = [
  ["Capsule filling machine NJP-1200", "pcs", 125_000, 2],
  ["Gate valve DN100 PN16", "pcs", 410, 200],
  ["PVC pipe 110mm, 6m", "pcs", 58, 2000],
  ["Woven PP bags 50kg", "pcs", 1.15, 100_000],
  ["Ball valve DN50, stainless", "pcs", 165, 500],
  ["Shrink film 25 micron", "ton", 11_000, 20],
  ["Blister packing machine DPP-260", "pcs", 98_000, 1],
  ["Copper cable 4mm², 100m", "roll", 620, 400],
  ["Cotton yarn 30s", "ton", 21_000, 25],
  ["Steel rebar 12mm", "ton", 3_900, 300],
];
const LOST = ["price_too_high", "no_reply", "factory_cannot_supply", "bought_elsewhere", "other"] as const;
const EXPENSE_ON_CUSTOMER = ["travel", "hotel", "meals", "samples", "gifts"] as const;

async function main() {
  const t0 = Date.now();
  const manager = await db.user.findFirstOrThrow({ where: { email: "manager@example.com" } });
  const pw = (await db.user.findFirstOrThrow({ where: { email: "bilal@example.com" } })).passwordHash;
  // A sales team of ten.
  const team = [manager.id];
  for (let i = 1; i <= 10; i++) {
    const u = await db.user.upsert({ where: { email: `sales${i}@example.com` }, update: {}, create: { email: `sales${i}@example.com`, name: `Sales ${i}`, passwordHash: pw, role: "staff" } });
    team.push(u.id);
  }
  const rate = 7.1;

  // Customers with a contact each, factories.
  const nCustomers = Math.max(50, Math.round(DEALS / 6));
  const customers = Array.from({ length: nCustomers }, (_, i) => ({ id: randomUUID(), name: `Load Customer ${String(i + 1).padStart(5, "0")} ${pick(["Trading", "Industries", "Imports", "Group", "Supplies"])}`, country: pick(COUNTRIES), createdById: manager.id }));
  for (let i = 0; i < customers.length; i += 1000) await db.customer.createMany({ data: customers.slice(i, i + 1000) });
  const contacts = customers.map((c) => ({ id: randomUUID(), customerId: c.id, name: `Buyer of ${c.name.slice(14, 19)}`, phone: `+92300${int(1_000_000, 9_999_999)}`, isPrimary: true }));
  for (let i = 0; i < contacts.length; i += 1000) await db.contact.createMany({ data: contacts.slice(i, i + 1000) });
  const factories = Array.from({ length: Math.max(30, Math.round(DEALS / 50)) }, (_, i) => ({ id: randomUUID(), name: `Load Factory ${String(i + 1).padStart(4, "0")} Co., Ltd.`, createdById: manager.id, ownerId: pick(team) }));
  await db.factory.createMany({ data: factories });
  console.log(`[load] ${customers.length} customers, ${factories.length} factories, ${team.length} people`);

  let made = 0;
  let orders = 0;
  async function deal(n: number) {
    const ci = int(0, customers.length - 1);
    const customer = customers[ci]!;
    const daysAgo = Math.floor((rnd() ** 0.8) * 1095);
    const created = addDays(today, -daysAgo);
    const year = Number(created.slice(0, 4));
    const r = rnd();
    // Older deals are settled; recent ones are still open.
    const stage: "new" | "sourcing" | "quoted" | "lost" | "won" = daysAgo > 60 ? (r < 0.55 ? "lost" : "won") : r < 0.15 ? "new" : r < 0.3 ? "sourcing" : r < 0.6 ? "quoted" : r < 0.75 ? "lost" : "won";
    const assignee = stage === "new" && rnd() < 0.5 ? null : pick(team);
    const nLines = int(1, 4);
    const lines = Array.from({ length: nLines }, () => {
      const [description, unit, price, qty] = pick(PRODUCTS);
      return { description, unit, factoryPrice: Math.round(price * (0.8 + rnd() * 0.4) * 100) / 100, quantity: Math.max(1, Math.round(qty * (0.3 + rnd()))) };
    });
    const inquiry = await db.inquiry.create({
      data: {
        refNo: await nextReference(db, "inquiry", year),
        customerId: customer.id,
        contactId: contacts[ci]!.id,
        channel: pick(["website", "whatsapp", "email", "phone"] as const),
        category: pick(CATEGORIES),
        title: lines[0]!.description + (nLines > 1 ? ` + ${nLines - 1} more` : ""),
        stage,
        lostReason: stage === "lost" ? pick(LOST) : null,
        assigneeId: assignee,
        createdById: pick(team),
        createdAt: new Date(`${created}T0${int(1, 9)}:00:00Z`),
        closedAt: stage === "won" || stage === "lost" ? new Date(`${addDays(created, int(3, 25))}T10:00:00Z`) : null,
        items: { create: lines.map((l, i) => ({ description: l.description, quantity: l.quantity, unit: l.unit, sortOrder: i })) },
        stageChanges: { create: [{ toStage: "new", cause: "created", changedById: manager.id, changedAt: new Date(`${created}T08:00:00Z`) }, ...(stage !== "new" ? [{ fromStage: "new" as const, toStage: stage as "won", cause: "load", changedById: assignee ?? manager.id, changedAt: new Date(`${addDays(created, 2)}T08:00:00Z`) }] : [])] },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    made++;
    if (stage === "new") return;
    const factory = pick(factories);
    const fq = await db.factoryQuote.create({
      data: {
        inquiryId: inquiry.id,
        factoryId: factory.id,
        receivedOn: toDbDate(addDays(created, 2)),
        validUntil: toDbDate(addDays(created, 32)),
        currency: "CNY",
        leadTime: "35 days after deposit",
        createdById: assignee ?? manager.id,
        lines: { create: lines.map((l, k) => ({ requestedItemId: inquiry.items[k]!.id, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.factoryPrice, taxRate: 13, sortOrder: k })) },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    if (stage === "sourcing") return;
    const costs = lines.map((l, k) => {
      const costCny = withTaxMinor(toMinor(l.factoryPrice), 13);
      return { lineId: fq.lines[k]!.id, costCny, costMinor: Math.round(costCny / rate) };
    });
    const quotation = await db.quotation.create({ data: { refNo: await nextReference(db, "quotation", year), inquiryId: inquiry.id } });
    const nRev = rnd() < 0.3 ? 2 : 1;
    let accepted: { id: string; total: number; lines: { id: string; type: "goods" | "charge" | "service"; description: string; model: string | null; quantity: unknown; unit: string; unitPrice: unknown; lineTotal: unknown; unitCost: unknown; sortOrder: number }[] } | null = null;
    for (let v = 0; v < nRev; v++) {
      const last = v === nRev - 1;
      const status = !last ? "superseded" : stage === "won" ? "accepted" : stage === "lost" ? (rnd() < 0.6 ? "rejected" : "expired") : "sent";
      const margin = int(10, 25) - v * 3;
      const priced = lines.map((l, k) => ({ l, unitPrice: priceForMargin(costs[k]!.costMinor, margin), cost: costs[k]! }));
      const totals = documentTotals(priced.map((x) => ({ quantity: x.l.quantity, unitPrice: fromMinor(x.unitPrice) })), 0);
      const header = { subtotal: fromMinor(totals.subtotal), total: fromMinor(totals.total) };
      const rev = await db.quotationRevision.create({
        data: {
          quotationId: quotation.id,
          number: v + 1,
          status,
          validUntil: toDbDate(addDays(created, 20 + v * 5)),
          sentOn: toDbDate(addDays(created, 3 + v * 3)),
          answeredOn: status === "accepted" || status === "rejected" ? toDbDate(addDays(created, 6 + v * 3)) : null,
          ...header,
          balanceTerms: "before_shipment",
          createdById: assignee ?? manager.id,
        },
      });
      const option = await db.quotationOption.create({
        data: {
          revisionId: rev.id,
          letter: "A",
          factoryQuoteId: fq.id,
          status: status === "accepted" ? "accepted" : "open",
          leadTime: "35 days after deposit",
          ...header,
          lines: {
            create: priced.map((x, k) => ({
              revisionId: rev.id,
              requestedItemId: inquiry.items[k]!.id,
              type: "goods" as const,
              description: x.l.description,
              quantity: x.l.quantity,
              unit: x.l.unit,
              unitPrice: fromMinor(x.unitPrice),
              lineTotal: fromMinor(totals.lines[k]!.lineTotal),
              unitCost: fromMinor(x.cost.costMinor),
              factoryQuoteLineId: x.cost.lineId,
              fxRate: rate,
              sortOrder: k,
            })),
          },
        },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (status === "accepted") accepted = { id: rev.id, total: totals.total, lines: option.lines };
    }
    if (!accepted) return;

    // The order: old ones are done; recent ones anywhere along the way.
    const orderedOn = addDays(created, int(5, 12));
    const age = daysAgo;
    const oStage: OrderStage = age > 120 ? "done" : age > 70 ? pick(["shipped", "done"] as const) : age > 30 ? pick(["in_production", "shipped"] as const) : pick(["confirmed", "in_production"] as const);
    const shippedOn = oStage === "shipped" || oStage === "done" ? addDays(orderedOn, int(25, 45)) : null;
    const stageSince = oStage === "confirmed" ? orderedOn : oStage === "in_production" ? addDays(orderedOn, 5) : oStage === "shipped" ? shippedOn! : addDays(shippedOn!, 20);
    const cancelled = rnd() < 0.03;
    const order = await db.order.create({
      data: {
        refNo: await nextReference(db, "order", year),
        inquiryId: inquiry.id,
        revisionId: accepted.id,
        customerId: customer.id,
        status: cancelled ? "cancelled" : oStage === "done" ? "closed" : "open",
        stage: oStage,
        stageSince: new Date(`${stageSince}T09:00:00Z`),
        closedAt: oStage === "done" ? new Date(`${stageSince}T09:00:00Z`) : null,
        orderedOn: toDbDate(orderedOn),
        readyOn: oStage === "confirmed" ? null : toDbDate(addDays(orderedOn, int(15, 40))),
        shippedOn: shippedOn ? toDbDate(shippedOn) : null,
        blNo: shippedOn ? `LOAD${n}` : null,
        currency: "USD",
        total: fromMinor(accepted.total),
        depositPercent: 30,
        balanceTerms: "before_shipment",
        incoterm: "FOB",
        incotermPlace: "Qingdao",
        createdById: manager.id,
        lines: {
          create: accepted.lines.map((l) => ({
            quoteLineId: l.id,
            type: l.type,
            description: l.description,
            quantity: l.quantity as never,
            unit: l.unit,
            unitPrice: l.unitPrice as never,
            lineTotal: l.lineTotal as never,
            unitCost: l.unitCost as never,
            sortOrder: l.sortOrder,
            ...(shippedOn ? { receivedQty: l.quantity as never, receivedOn: toDbDate(addDays(shippedOn, -5)), packages: 10, packageType: "Carton" } : {}),
          })),
        },
      },
    });
    orders++;
    const flow: OrderStage[] = ["confirmed", "in_production", "shipped", "done"];
    await db.orderStageChange.createMany({
      data: flow.slice(0, flow.indexOf(oStage) + 1).map((st, i) => ({ orderId: order.id, fromStage: i === 0 ? null : flow[i - 1]!, toStage: st, byId: assignee ?? manager.id, at: new Date(`${addDays(orderedOn, i * 15)}T09:00:00Z`) })),
    });
    await db.paymentPlanItem.createMany({
      data: defaultPlan(accepted.total, 30, orderedOn, 7).map((p, k) => ({ orderId: order.id, label: p.label, amount: fromMinor(p.amountMinor), dueOn: p.dueOn ? toDbDate(p.dueOn) : shippedOn ? toDbDate(addDays(shippedOn, 14)) : null, sortOrder: k })),
    });
    const cny = costs.reduce((t, c, k) => t + Math.round(c.costCny * lines[k]!.quantity), 0);
    if (oStage !== "confirmed") await db.factoryPayment.create({ data: { orderId: order.id, factoryId: factory.id, kind: "deposit", amount: fromMinor(Math.round(cny * 0.3)), currency: "CNY", rate, paidOn: toDbDate(addDays(orderedOn, 6)), reference: `FP-${n}-1`, recordedById: manager.id, paidById: assignee } });
    if (shippedOn) await db.factoryPayment.create({ data: { orderId: order.id, factoryId: factory.id, kind: "balance", amount: fromMinor(cny - Math.round(cny * 0.3)), currency: "CNY", rate, paidOn: toDbDate(addDays(shippedOn, -3)), reference: `FP-${n}-2`, recordedById: manager.id, paidById: assignee } });
    const { deposit, balance } = splitDeposit(accepted.total, 30);
    if (oStage !== "confirmed" || rnd() < 0.5) await db.payment.create({ data: { kind: "deposit", orderId: order.id, customerId: customer.id, amount: fromMinor(deposit - 2500), bankCharges: "25.00", currency: "USD", paidOn: toDbDate(addDays(orderedOn, 4)), reference: `TT-${n}-1`, recordedById: manager.id } });
    if (oStage === "done" || (oStage === "shipped" && rnd() < 0.5)) await db.payment.create({ data: { kind: "balance", orderId: order.id, customerId: customer.id, amount: fromMinor(balance), currency: "USD", paidOn: toDbDate(addDays(shippedOn ?? orderedOn, 5)), reference: `TT-${n}-2`, recordedById: manager.id } });
    if (shippedOn)
      await db.expense.createMany({
        data: [
          { orderId: order.id, inquiryId: inquiry.id, customerId: customer.id, category: "inland_transport", description: "Truck to Qingdao port", amount: String(int(1500, 5000)), currency: "CNY", rate, spentOn: toDbDate(addDays(shippedOn, -2)), recordedById: manager.id },
          { orderId: order.id, inquiryId: inquiry.id, customerId: customer.id, category: "inspection", description: "Pre-shipment inspection", amount: String(int(150, 400)), currency: "USD", rate: 1, spentOn: toDbDate(addDays(shippedOn, -4)), recordedById: manager.id },
        ],
      });
  }

  // Deals, a few at a time.
  let next = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < DEALS) {
        const n = next++;
        await deal(n);
        if (made % 1000 === 0) console.log(`[load] ${made} deals, ${orders} orders (${Math.round((Date.now() - t0) / 1000)}s)`);
      }
    }),
  );

  // Company costs every month for three years, and money spent on customers.
  const monthly = [];
  for (let m = 0; m < 36; m++) {
    const on = toDbDate(addDays(today, -m * 30));
    monthly.push(
      { category: "rent", description: "Office rent", amount: "8000.00", currency: "CNY", rate, spentOn: on, recordedById: manager.id },
      { category: "salaries", description: "Salaries", amount: "60000.00", currency: "CNY", rate, spentOn: on, recordedById: manager.id },
      { category: "utilities", description: "Phone and internet", amount: "450.00", currency: "CNY", rate, spentOn: on, recordedById: manager.id },
    );
  }
  await db.expense.createMany({ data: monthly });
  const onCustomers = Array.from({ length: Math.round(DEALS / 2) }, () => {
    const c = pick(customers);
    return { customerId: c.id, category: pick(EXPENSE_ON_CUSTOMER), description: "Visit and samples", amount: String(int(100, 3000)), currency: pick(["USD", "CNY"]), rate: 1, spentOn: toDbDate(addDays(today, -int(0, 1095))), recordedById: manager.id };
  }).map((e) => ({ ...e, rate: e.currency === "USD" ? 1 : rate }));
  for (let i = 0; i < onCustomers.length; i += 2000) await db.expense.createMany({ data: onCustomers.slice(i, i + 2000) });

  // Notifications and an audit trail, as the app writes them over the years.
  const notes = Array.from({ length: DEALS * 3 }, (_, i) => ({ userId: pick(team), type: pick(["inquiry.created", "payment.recorded", "reminder.order"]), title: `Load notification ${i}`, link: "/deals", readAt: rnd() < 0.9 ? new Date() : null, createdAt: new Date(`${addDays(today, -int(0, 1095))}T10:00:00Z`) }));
  for (let i = 0; i < notes.length; i += 5000) await db.notification.createMany({ data: notes.slice(i, i + 5000) });
  const audit = Array.from({ length: DEALS * 10 }, (_, i) => ({ userId: pick(team), action: pick(["inquiry_update", "payment_in", "order_stage", "quotation_sent"]), entityType: pick(["inquiry", "order", "customer"]), summary: `Load change ${i}`, createdAt: new Date(`${addDays(today, -int(0, 1095))}T11:00:00Z`) }));
  for (let i = 0; i < audit.length; i += 5000) await db.auditLog.createMany({ data: audit.slice(i, i + 5000) });

  await db.$executeRawUnsafe("analyze");
  console.log(`[load] done: ${made} deals, ${orders} orders, ${monthly.length + onCustomers.length} expenses, ${notes.length} notifications, ${audit.length} audit entries in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main()
  .catch((e) => {
    console.error("[load] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
