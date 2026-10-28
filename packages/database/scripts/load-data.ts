/**
 * Load data: months or years of realistic history, to see the charts and
 * reports with a working company's data, and for load tests. For development
 * only — refused against a non-local database.
 *
 *   pnpm db:load-data                          one year, about 1,200 deals
 *   pnpm db:load-data --years 3 --deals 10000  the load-test set
 *   options: --years N  --deals N  --people N (sales people, default 6)
 *
 * Deals go through the same shape the app makes: items, a factory offer,
 * quotation revisions, and for won deals an order with its payment plan,
 * payments in and out, expenses and stage history. Business grows over the
 * period, so the charts have a shape. Nothing is dated after today. Also:
 * company costs every month, money spent on customers, a monthly sales
 * target, bank accounts (when there are none) and the PKR rate (when it is
 * missing). Run it on top of `pnpm db:seed` (any users); it adds, it never
 * deletes. Sales people sign in as sales1@example.com … with Demo@12345.
 */
import "./env";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { documentTotals, fromMinor, priceForMargin, splitDeposit, toMinor, withTaxMinor } from "@kebo/money";
import { defaultPlan, type OrderStage } from "@kebo/shared";
import { addDays, daysBetween, todayIn, type ISODate } from "@kebo/utils";
import { createPrismaClient, nextReference, toDbDate } from "../src";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "db", "postgres", "host.docker.internal"].includes(host)) throw new Error(`Refusing to load test data into ${host}: local databases only.`);
const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : d;
};
const YEARS = arg("years", 1);
const DAYS = Math.round(YEARS * 365);
const DEALS = Math.round(arg("deals", 1200 * YEARS));
const PEOPLE = Math.min(arg("people", 6), 50);
const WORKERS = arg("workers", 8);
const db = createPrismaClient({ url });
const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
const today = todayIn(tz);
/** Never after today. */
const upTo = (d: ISODate): ISODate => (d > today ? today : d);
/** The first day of the month `back` months before this one. */
const monthStart = (back: number): ISODate => {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10) as ISODate;
};

// A fixed seed, so two runs make the same data.
let seed = 42;
const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const COUNTRIES = ["PK", "NG", "AE", "KE", "SA", "EG", "BD", "TZ", "GH", "IQ", "OM", "QA", "ET", "UZ", "KZ"];
const CITIES: Record<string, string[]> = {
  PK: ["Karachi", "Lahore", "Faisalabad", "Sialkot"],
  NG: ["Lagos", "Kano", "Abuja"],
  AE: ["Dubai", "Sharjah", "Abu Dhabi"],
  KE: ["Nairobi", "Mombasa"],
  SA: ["Riyadh", "Jeddah", "Dammam"],
  EG: ["Cairo", "Alexandria"],
  BD: ["Dhaka", "Chittagong"],
  TZ: ["Dar es Salaam", "Arusha"],
  GH: ["Accra", "Kumasi"],
  IQ: ["Baghdad", "Basra", "Erbil"],
  OM: ["Muscat", "Sohar"],
  QA: ["Doha"],
  ET: ["Addis Ababa"],
  UZ: ["Tashkent", "Samarkand"],
  KZ: ["Almaty", "Astana"],
};
const TRADES = ["Pharma", "Foods", "Builders", "Agro", "Steel", "Plastics", "Packaging", "Textiles", "Engineering", "Chemicals", "Electric", "Water"];
const SUFFIXES = ["Ltd", "Trading LLC", "Industries", "Imports", "Group", "Supplies", "& Co."];
const BUYERS = ["Ahmed Raza", "Ibrahim Musa", "Omar Haddad", "Grace Wanjiru", "Usman Tariq", "Fatima Bello", "Khalid Nasser", "Amina Yusuf", "Bilal Khan", "Joseph Mensah", "Sara Al-Amri", "Rustam Aliyev"];
const FACTORY_CITIES = ["Jining", "Wenzhou", "Qingdao", "Ningbo", "Foshan", "Wuxi", "Taizhou", "Jinan", "Shijiazhuang", "Changzhou", "Hangzhou", "Dongguan"];
const FACTORY_TRADES = ["Pharma Machinery", "Valve Works", "Packaging", "Pipe Industry", "Cable", "Textile Machinery", "Steel", "Plastic Products", "Pump", "Electric Appliance"];
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
const LOST = ["price_too_high", "price_too_high", "no_reply", "factory_cannot_supply", "bought_elsewhere", "other"] as const;
const EXPENSE_ON_CUSTOMER = ["travel", "hotel", "meals", "samples", "gifts"] as const;

async function main() {
  const t0 = Date.now();
  const startedAt = new Date();
  const found = await db.user.findFirst({ where: { isSystem: false, isActive: true, role: { in: ["manager", "admin"] } }, orderBy: [{ role: "desc" }, { createdAt: "asc" }] });
  if (!found) throw new Error("No admin or manager yet: run `pnpm db:seed` first.");
  const lead = found;
  // A sales team.
  const pw = await bcrypt.hash("Demo@12345", 10);
  const team = [lead.id];
  for (let i = 1; i <= PEOPLE; i++) {
    const u = await db.user.upsert({ where: { email: `sales${i}@example.com` }, update: {}, create: { email: `sales${i}@example.com`, name: `Sales ${i}`, passwordHash: pw, role: "staff" } });
    team.push(u.id);
  }
  const rate = 7.1;

  // Customers with a contact each, and factories, with real-looking names.
  const nCustomers = Math.max(30, Math.round(DEALS / 6));
  const used = new Set<string>();
  const customers = Array.from({ length: nCustomers }, () => {
    const country = pick(COUNTRIES);
    let name = "";
    for (let tries = 0; tries < 20 && (!name || used.has(name)); tries++) name = `${pick(CITIES[country]!)} ${pick(TRADES)} ${pick(SUFFIXES)}`;
    if (used.has(name)) name = `${name} ${used.size}`;
    used.add(name);
    return { id: randomUUID(), name, country, createdById: lead.id, createdAt: new Date(`${addDays(today, -int(0, DAYS))}T06:00:00Z`) };
  });
  for (let i = 0; i < customers.length; i += 1000) await db.customer.createMany({ data: customers.slice(i, i + 1000) });
  const contacts = customers.map((c) => ({ id: randomUUID(), customerId: c.id, name: pick(BUYERS), phone: `+92300${int(1_000_000, 9_999_999)}`, isPrimary: true }));
  for (let i = 0; i < contacts.length; i += 1000) await db.contact.createMany({ data: contacts.slice(i, i + 1000) });
  const fnames = new Set<string>();
  const factories = Array.from({ length: Math.max(15, Math.round(DEALS / 40)) }, () => {
    let name = "";
    for (let tries = 0; tries < 20 && (!name || fnames.has(name)); tries++) name = `${pick(FACTORY_CITIES)} ${pick(FACTORY_TRADES)} Co., Ltd.`;
    if (fnames.has(name)) name = `${name.replace(" Co., Ltd.", "")} ${fnames.size} Co., Ltd.`;
    fnames.add(name);
    return { id: randomUUID(), name, createdById: lead.id, ownerId: pick(team) };
  });
  await db.factory.createMany({ data: factories });
  console.log(`[load] ${YEARS} year${YEARS === 1 ? "" : "s"}: ${customers.length} customers, ${factories.length} factories, ${team.length} people`);

  let made = 0;
  let orders = 0;
  async function deal(n: number) {
    const ci = int(0, customers.length - 1);
    const customer = customers[ci]!;
    // Business grows: more deals in recent months than at the start of the period.
    const daysAgo = Math.floor(rnd() ** 1.35 * DAYS);
    const created = addDays(today, -daysAgo);
    const year = Number(created.slice(0, 4));
    const r = rnd();
    // Older deals are settled; recent ones are still open.
    const stage: "new" | "sourcing" | "quoted" | "lost" | "won" =
      daysAgo > 45 ? (r < 0.55 ? "lost" : "won") : r < 0.15 ? "new" : r < 0.3 ? "sourcing" : r < 0.6 ? "quoted" : r < 0.78 ? "lost" : "won";
    const assignee = stage === "new" && rnd() < 0.5 ? null : pick(team);
    const nLines = int(1, 4);
    const lines = Array.from({ length: nLines }, () => {
      const [description, unit, price, qty] = pick(PRODUCTS);
      return { description, unit, factoryPrice: Math.round(price * (0.8 + rnd() * 0.4) * 100) / 100, quantity: Math.max(1, Math.round(qty * (0.3 + rnd()))) };
    });
    const closedOn = upTo(addDays(created, int(3, 25)));
    const inquiry = await db.inquiry.create({
      data: {
        refNo: await nextReference(db, "inquiry", year),
        customerId: customer.id,
        contactId: contacts[ci]!.id,
        channel: pick(["website", "whatsapp", "whatsapp", "email", "phone", "wechat"] as const),
        category: pick(CATEGORIES),
        title: lines[0]!.description + (nLines > 1 ? ` + ${nLines - 1} more` : ""),
        stage,
        lostReason: stage === "lost" ? pick(LOST) : null,
        assigneeId: assignee,
        createdById: pick(team),
        createdAt: new Date(`${created}T0${int(1, 9)}:00:00Z`),
        closedAt: stage === "won" || stage === "lost" ? new Date(`${closedOn}T10:00:00Z`) : null,
        items: { create: lines.map((l, i) => ({ description: l.description, quantity: l.quantity, unit: l.unit, sortOrder: i })) },
        stageChanges: {
          create: [
            { toStage: "new", cause: "created", changedById: lead.id, changedAt: new Date(`${created}T08:00:00Z`) },
            ...(stage !== "new" ? [{ fromStage: "new" as const, toStage: stage as "won", cause: "load", changedById: assignee ?? lead.id, changedAt: new Date(`${upTo(addDays(created, 2))}T08:00:00Z`) }] : []),
          ],
        },
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
        receivedOn: toDbDate(upTo(addDays(created, 2))),
        validUntil: toDbDate(addDays(created, 32)),
        currency: "CNY",
        leadTime: "35 days after deposit",
        createdById: assignee ?? lead.id,
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
    let accepted: { id: string; total: number; lines: { id: string; type: "goods" | "charge" | "service"; description: string; quantity: unknown; unit: string; unitPrice: unknown; lineTotal: unknown; unitCost: unknown; sortOrder: number }[] } | null = null;
    for (let v = 0; v < nRev; v++) {
      const last = v === nRev - 1;
      const status = !last ? "superseded" : stage === "won" ? "accepted" : stage === "lost" ? (rnd() < 0.6 ? "rejected" : "expired") : "sent";
      const margin = int(10, 25) - v * 3;
      const priced = lines.map((l, k) => ({ l, unitPrice: priceForMargin(costs[k]!.costMinor, margin), cost: costs[k]! }));
      const totals = documentTotals(priced.map((x) => ({ quantity: x.l.quantity, unitPrice: fromMinor(x.unitPrice) })), 0);
      const header = { subtotal: fromMinor(totals.subtotal), total: fromMinor(totals.total) };
      const sentOn = upTo(addDays(created, 3 + v * 3));
      const rev = await db.quotationRevision.create({
        data: {
          quotationId: quotation.id,
          number: v + 1,
          status,
          validUntil: toDbDate(addDays(sentOn, 15)),
          sentOn: toDbDate(sentOn),
          answeredOn: status === "accepted" || status === "rejected" ? toDbDate(closedOn < sentOn ? sentOn : closedOn) : null,
          ...header,
          balanceTerms: "before_shipment",
          createdById: assignee ?? lead.id,
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

    // The order, on the day the deal was won; how far it got depends on how long ago that was.
    const orderedOn = closedOn;
    const age = daysBetween(orderedOn, today);
    let oStage: OrderStage = age > 100 ? "done" : age > 60 ? pick(["shipped", "done"] as const) : age > 20 ? pick(["in_production", "shipped"] as const) : pick(["confirmed", "in_production"] as const);
    let shippedOn: ISODate | null = oStage === "shipped" || oStage === "done" ? addDays(orderedOn, int(25, 45)) : null;
    if (shippedOn && shippedOn > today) {
      oStage = "in_production";
      shippedOn = null;
    }
    const doneOn = shippedOn ? upTo(addDays(shippedOn, 20)) : null;
    const stageSince = oStage === "confirmed" ? orderedOn : oStage === "in_production" ? upTo(addDays(orderedOn, 5)) : oStage === "shipped" ? shippedOn! : doneOn!;
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
        shipBy: toDbDate(addDays(orderedOn, int(30, 45))),
        shippedOn: shippedOn ? toDbDate(shippedOn) : null,
        blNo: shippedOn ? `QDLOS${300_000 + n}` : null,
        currency: "USD",
        total: fromMinor(accepted.total),
        depositPercent: 30,
        balanceTerms: "before_shipment",
        incoterm: "FOB",
        incotermPlace: "Qingdao",
        createdById: lead.id,
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
    const stageDay = (st: OrderStage) => (st === "confirmed" ? orderedOn : st === "in_production" ? upTo(addDays(orderedOn, 5)) : st === "shipped" ? shippedOn! : doneOn!);
    await db.orderStageChange.createMany({
      data: flow.slice(0, flow.indexOf(oStage) + 1).map((st, i) => ({ orderId: order.id, fromStage: i === 0 ? null : flow[i - 1]!, toStage: st, byId: assignee ?? lead.id, at: new Date(`${stageDay(st)}T09:00:00Z`) })),
    });
    await db.paymentPlanItem.createMany({
      data: defaultPlan(accepted.total, 30, orderedOn, 7).map((p, k) => ({ orderId: order.id, label: p.label, amount: fromMinor(p.amountMinor), dueOn: p.dueOn ? toDbDate(p.dueOn) : shippedOn ? toDbDate(addDays(shippedOn, 14)) : null, sortOrder: k })),
    });
    if (cancelled) return;
    const cny = costs.reduce((t, c, k) => t + Math.round(c.costCny * lines[k]!.quantity), 0);
    const pay = (on: ISODate) => on <= today;
    if (oStage !== "confirmed" && pay(addDays(orderedOn, 6)))
      await db.factoryPayment.create({ data: { orderId: order.id, factoryId: factory.id, kind: "deposit", amount: fromMinor(Math.round(cny * 0.3)), currency: "CNY", rate, paidOn: toDbDate(addDays(orderedOn, 6)), reference: `FP-${n}-1`, recordedById: lead.id, paidById: assignee } });
    if (shippedOn)
      await db.factoryPayment.create({ data: { orderId: order.id, factoryId: factory.id, kind: "balance", amount: fromMinor(cny - Math.round(cny * 0.3)), currency: "CNY", rate, paidOn: toDbDate(addDays(shippedOn, -3)), reference: `FP-${n}-2`, recordedById: lead.id, paidById: assignee } });
    const { deposit, balance } = splitDeposit(accepted.total, 30);
    // Most customers pay the deposit on time; a few are late, so "overdue" has something in it.
    if ((oStage !== "confirmed" || rnd() < 0.5) && pay(addDays(orderedOn, 4)) && rnd() < 0.95)
      await db.payment.create({ data: { kind: "deposit", orderId: order.id, customerId: customer.id, amount: fromMinor(deposit - 2500), bankCharges: "25.00", currency: "USD", paidOn: toDbDate(addDays(orderedOn, 4)), reference: `TT-${n}-1`, recordedById: lead.id } });
    if (shippedOn && (oStage === "done" ? rnd() < 0.96 : rnd() < 0.5) && pay(addDays(shippedOn, 5)))
      await db.payment.create({ data: { kind: "balance", orderId: order.id, customerId: customer.id, amount: fromMinor(balance), currency: "USD", paidOn: toDbDate(addDays(shippedOn, 5)), reference: `TT-${n}-2`, recordedById: lead.id } });
    if (shippedOn)
      await db.expense.createMany({
        data: [
          { orderId: order.id, inquiryId: inquiry.id, customerId: customer.id, category: "inland_transport", description: "Truck to Qingdao port", amount: String(int(1500, 5000)), currency: "CNY", rate, spentOn: toDbDate(addDays(shippedOn, -2)), recordedById: lead.id },
          { orderId: order.id, inquiryId: inquiry.id, customerId: customer.id, category: "inspection", description: "Pre-shipment inspection", amount: String(int(150, 400)), currency: "USD", rate: 1, spentOn: toDbDate(addDays(shippedOn, -4)), recordedById: lead.id },
        ],
      });
  }

  // Deals, a few at a time.
  let next = 0;
  const step = Math.max(100, Math.round(DEALS / 10));
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < DEALS) {
        const n = next++;
        await deal(n);
        if (made % step === 0) console.log(`[load] ${made} deals, ${orders} orders (${Math.round((Date.now() - t0) / 1000)}s)`);
      }
    }),
  );

  // Company costs every month, and money spent on customers (visits, dinners, samples).
  const months = Math.ceil(DAYS / 30.4);
  const monthly = [];
  for (let m = 0; m < months; m++) {
    const on = toDbDate(monthStart(m));
    monthly.push(
      { category: "rent", description: "Office rent", amount: "8000.00", currency: "CNY", rate, spentOn: on, recordedById: lead.id },
      { category: "salaries", description: "Salaries", amount: String(42_000 + int(0, 6) * 1000), currency: "CNY", rate, spentOn: on, recordedById: lead.id },
      { category: "utilities", description: "Phone and internet", amount: String(380 + int(0, 140)), currency: "CNY", rate, spentOn: on, recordedById: lead.id },
    );
  }
  await db.expense.createMany({ data: monthly });
  const onCustomers = Array.from({ length: Math.round(DEALS / 3) }, () => {
    const c = pick(customers);
    const category = pick(EXPENSE_ON_CUSTOMER);
    const description = { travel: "Flight to visit the customer", hotel: "Hotel during the visit", meals: "Dinner with the buyers", samples: "Samples by courier", gifts: "Gift set" }[category];
    const currency = pick(["USD", "CNY", "CNY"]);
    return { customerId: c.id, category, description, amount: String(currency === "USD" ? int(80, 1500) : int(300, 6000)), currency, rate: currency === "USD" ? 1 : rate, spentOn: toDbDate(addDays(today, -Math.floor(rnd() ** 1.2 * DAYS))), recordedById: lead.id };
  });
  for (let i = 0; i < onCustomers.length; i += 2000) await db.expense.createMany({ data: onCustomers.slice(i, i + 2000) });

  // Notifications and an audit trail, as the app writes them.
  const notes = Array.from({ length: DEALS * 2 }, (_, i) => ({ userId: pick(team), type: pick(["inquiry.created", "payment.recorded", "reminder.order"]), title: `Notification ${i}`, link: "/deals", readAt: rnd() < 0.9 ? new Date() : null, createdAt: new Date(`${addDays(today, -int(0, DAYS))}T10:00:00Z`) }));
  for (let i = 0; i < notes.length; i += 5000) await db.notification.createMany({ data: notes.slice(i, i + 5000) });
  const audit = Array.from({ length: DEALS * 5 }, (_, i) => ({ userId: pick(team), action: pick(["inquiry_update", "payment_in", "order_stage", "quotation_sent"]), entityType: pick(["inquiry", "order", "customer"]), summary: `Change ${i}`, createdAt: new Date(`${addDays(today, -int(0, DAYS))}T11:00:00Z`) }));
  for (let i = 0; i < audit.length; i += 5000) await db.auditLog.createMany({ data: audit.slice(i, i + 5000) });

  // Our accounts: when there are none yet, a USD and a CNY bank account, and the new money put on them.
  if ((await db.moneyAccount.count()) === 0) {
    const opened = toDbDate(addDays(today, -DAYS - 10));
    await db.moneyAccount.create({ data: { name: "Bank Alfalah USD", kind: "bank", currency: "USD", openingBalance: "50000.00", openingOn: opened } });
    await db.moneyAccount.create({ data: { name: "ICBC Jining CNY", kind: "bank", currency: "CNY", openingBalance: "800000.00", openingOn: opened } });
  }
  const usd = await db.moneyAccount.findFirst({ where: { currency: "USD", archivedAt: null }, orderBy: { createdAt: "asc" } });
  const cnyAcct = await db.moneyAccount.findFirst({ where: { currency: "CNY", archivedAt: null }, orderBy: { createdAt: "asc" } });
  const mine = { createdAt: { gte: startedAt }, accountId: null };
  if (usd) {
    await db.payment.updateMany({ where: { ...mine, currency: "USD" }, data: { accountId: usd.id } });
    await db.expense.updateMany({ where: { ...mine, currency: "USD" }, data: { accountId: usd.id } });
  }
  if (cnyAcct) {
    await db.factoryPayment.updateMany({ where: { ...mine, currency: "CNY" }, data: { accountId: cnyAcct.id } });
    // A few CNY expenses left off an account, so the cash book has something to point out.
    const left = await db.expense.findMany({ where: { ...mine, currency: "CNY" }, select: { id: true } });
    await db.expense.updateMany({ where: { id: { in: left.filter(() => rnd() < 0.97).map((e) => e.id) } }, data: { accountId: cnyAcct.id } });
  }

  // Currencies: the PKR rate when it is missing (the demo has a PKR cash account).
  const salesRow = await db.setting.findUnique({ where: { key: "sales" } });
  const sales = (salesRow?.value ?? {}) as { currency?: string; exchangeRates?: Record<string, number> };
  if (salesRow && !sales.exchangeRates?.PKR) {
    await db.setting.update({ where: { key: "sales" }, data: { value: { ...sales, exchangeRates: { ...(sales.exchangeRates ?? {}), PKR: 280 } } } });
    console.log("[load] PKR rate set to 280 per USD (it was missing)");
  }

  // A sales target for each month without one: a little above what was sold that month, rounded.
  const byMonth = await db.$queryRaw<{ m: string; total: number }[]>`
    select to_char(ordered_on, 'YYYY-MM') as m, sum(total)::float8 as total
    from orders where status <> 'cancelled' and ordered_on >= ${addDays(today, -DAYS)}::date group by 1`;
  const sold = new Map(byMonth.map((r) => [r.m, r.total]));
  const avg = byMonth.length ? byMonth.reduce((t, r) => t + r.total, 0) / byMonth.length : 0;
  let targets = 0;
  for (let m = 0; m < months; m++) {
    const month = monthStart(m).slice(0, 7);
    if (await db.salesTarget.findUnique({ where: { month } })) continue;
    const base = Math.max(sold.get(month) ?? 0, avg * 0.8);
    if (!base) continue;
    await db.salesTarget.create({ data: { month, amount: String(Math.ceil((base * (0.95 + rnd() * 0.3)) / 10_000) * 10_000), currency: sales.currency ?? "USD", updatedById: lead.id } });
    targets++;
  }

  await db.$executeRawUnsafe("analyze");
  console.log(
    `[load] done in ${Math.round((Date.now() - t0) / 1000)}s: ${made} deals, ${orders} orders, ${monthly.length + onCustomers.length} expenses, ${targets} monthly targets, ${notes.length} notifications, ${audit.length} audit entries.`,
  );
  console.log(`[load] sales people: sales1@example.com … sales${PEOPLE}@example.com, password Demo@12345`);
}

main()
  .catch((e) => {
    console.error("[load] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
