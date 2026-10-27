/**
 * Seed: the starting accounts and settings; with --demo, sample deals at every
 * stage (for development only — refused against a non-local database).
 *
 *   pnpm db:seed            accounts + settings (safe to run again)
 *   pnpm db:seed --demo     plus sample customers, factories and deals
 */
import "./env";
import bcrypt from "bcryptjs";
import { documentTotals, fromMinor, splitDeposit, withTaxMinor, priceForMargin, toMinor } from "@kebo/money";
import { defaultPlan, PRESET_ROLES, readSettings, SETTINGS, type BalanceTerms, type OrderStage, type SettingsKey } from "@kebo/shared";
import { addDays, todayIn } from "@kebo/utils";
import { createPrismaClient, nextReference, toDbDate, type PrismaClient } from "../src";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const demo = process.argv.includes("--demo");
const prisma = createPrismaClient({ url });
const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";

async function upsertUser(email: string, name: string, role: "admin" | "manager" | "staff", password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const user = await prisma.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(password, 12) } });
  console.log(`[seed] ${role.padEnd(7)} ${email} created`);
  return user;
}

async function seedBase() {
  // The migration makes the three preset roles; this only puts back one that is missing.
  for (const [key, r] of Object.entries(PRESET_ROLES)) {
    await prisma.role.upsert({
      where: { key },
      update: {},
      create: { key, name: r.name, description: r.description, permissions: r.superAdmin ? [] : [...r.permissions], superAdmin: r.superAdmin },
    });
  }
  const admin = await upsertUser(process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", process.env.SEED_ADMIN_NAME ?? "Super Admin", "admin", process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345");
  const manager = await upsertUser(process.env.SEED_MANAGER_EMAIL ?? "manager@example.com", process.env.SEED_MANAGER_NAME ?? "Manager", "manager", process.env.SEED_MANAGER_PASSWORD ?? "Manager@12345");
  const staff = await upsertUser(process.env.SEED_STAFF_EMAIL ?? "staff@example.com", process.env.SEED_STAFF_NAME ?? "Staff", "staff", process.env.SEED_STAFF_PASSWORD ?? "Staff@12345");
  // The account website inquiries are recorded under; it can never sign in.
  await prisma.user.upsert({
    where: { email: "website-form@system.local" },
    update: {},
    create: { email: "website-form@system.local", name: "Website form", role: "staff", isSystem: true, isActive: false, passwordHash: "!" },
  });
  const stored = Object.fromEntries((await prisma.setting.findMany()).map((s) => [s.key, s.value])) as Partial<Record<SettingsKey, unknown>>;
  const complete = readSettings(stored);
  for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
    if (!(key in stored)) await prisma.setting.create({ data: { key, value: complete[key] as object } });
  }
  return { admin, manager, staff };
}

/* ---------------------------------------------------------------- demo data */

function assertLocal() {
  const host = new URL(url!).hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "db", "postgres"].includes(host)) {
    throw new Error("Demo data is only for a database on your own computer (its logins use a published password).");
  }
}

type Line = { description: string; model?: string; quantity: number; unit?: string; factoryPrice: number; factory: number; type?: "goods" | "charge" };


async function demoData(db: PrismaClient, people: Awaited<ReturnType<typeof seedBase>>) {
  assertLocal();
  if ((await db.inquiry.count()) > 0) {
    console.log("[seed] demo data already present, skipped");
    return;
  }
  const today = todayIn(tz);
  const year = Number(today.slice(0, 4));
  const bilal = await upsertUser("bilal@example.com", "Bilal", "staff", "Demo@12345");
  const sana = await upsertUser("sana@example.com", "Sana", "staff", "Demo@12345");

  const customers = await Promise.all(
    [
      { name: "Al-Shifa Pharma Ltd", country: "NG", contact: "Ibrahim Musa", phone: "+2348031234567" },
      { name: "Gulf Foods Trading LLC", country: "AE", contact: "Omar Haddad", phone: "+971501234567" },
      { name: "Karachi Builders", country: "PK", contact: "Usman Tariq", phone: "+923001234567" },
      { name: "Nairobi Agro Supplies", country: "KE", contact: "Grace Wanjiru", phone: "+254712345678" },
    ].map((c) =>
      db.customer.create({
        data: { name: c.name, country: c.country, createdById: people.manager.id, contacts: { create: { name: c.contact, phone: c.phone, whatsapp: c.phone, isPrimary: true } } },
        include: { contacts: true },
      }),
    ),
  );
  const factories = await Promise.all(
    ["Jinan Pharma Machinery", "Wenzhou Valve Works", "Qingdao Packaging Co."].map((name) => db.factory.create({ data: { name, createdById: people.manager.id } })),
  );
  const settings = readSettings({});
  const rate = settings.sales.exchangeRates.CNY ?? 7.1;

  /** A deal with items and (optionally) factory prices, quotation revisions and an order. */
  async function deal(o: {
    customer: number;
    assignee?: string | null;
    stage: "new" | "sourcing" | "quoted" | "won" | "lost";
    category: string;
    lines: Line[];
    daysAgo: number;
    revisions?: ("sent" | "superseded" | "accepted" | "rejected")[];
    lostReason?: "price_too_high";
    /** The order and how far it got: its stage, what the customer paid, and dates relative to the order day. */
    order?: { stage: OrderStage; paid: "none" | "deposit" | "full"; terms?: BalanceTerms; readyInDays?: number; shippedAfterDays?: number };
  }) {
    const created = addDays(today, -o.daysAgo);
    const customer = customers[o.customer];
    const inquiry = await db.inquiry.create({
      data: {
        refNo: await nextReference(db, "inquiry", year),
        customerId: customer.id,
        contactId: customer.contacts[0].id,
        channel: o.customer % 2 ? "whatsapp" : "website",
        category: o.category,
        title: o.lines[0].description + (o.lines.length > 1 ? ` + ${o.lines.length - 1} more` : ""),
        stage: o.stage,
        lostReason: o.lostReason ?? null,
        assigneeId: o.assignee ?? null,
        createdById: people.staff.id,
        createdAt: toDbDate(created),
        closedAt: o.stage === "won" || o.stage === "lost" ? toDbDate(addDays(created, 6)) : null,
        items: { create: o.lines.filter((l) => l.type !== "charge").map((l, i) => ({ description: l.description, model: l.model, quantity: l.quantity, unit: l.unit ?? "pcs", sortOrder: i })) },
        stageChanges: { create: { toStage: "new", cause: "created", changedById: people.staff.id, changedAt: toDbDate(created) } },
      },
      include: { items: true },
    });
    if (o.stage !== "new") {
      await db.inquiryStageChange.create({ data: { inquiryId: inquiry.id, fromStage: "new", toStage: o.stage, cause: o.stage === "lost" ? "manual" : "demo", lostReason: o.lostReason, changedById: people.manager.id } });
    }
    if (o.stage === "new") return;

    // Factory prices (CNY, without tax; each item's 13% tax is added on top): one offer per factory with its lines.
    const costByLine = new Map<number, { lineId: string; costMinor: number; costCny: number; factory: number }>();
    const offerOf = new Map<number, string>();
    for (const f of [...new Set(o.lines.filter((l) => l.type !== "charge").map((l) => l.factory))]) {
      const mine = [...o.lines.entries()].filter(([, l]) => l.type !== "charge" && l.factory === f);
      const fq = await db.factoryQuote.create({
        data: {
          inquiryId: inquiry.id,
          factoryId: factories[f].id,
          receivedOn: toDbDate(addDays(created, 2)),
          currency: "CNY",
          leadTime: "35 days after deposit",
          createdById: o.assignee ?? people.staff.id,
          lines: { create: mine.map(([i, l], k) => ({ requestedItemId: inquiry.items[i]?.id, description: l.description, model: l.model, quantity: l.quantity, unit: l.unit ?? "pcs", unitPrice: l.factoryPrice, taxRate: 13, sortOrder: k })) },
        },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      offerOf.set(f, fq.id);
      for (const [k, [i, l]] of mine.entries()) {
        const costCny = withTaxMinor(toMinor(l.factoryPrice), Number(fq.lines[k].taxRate));
        costByLine.set(i, { lineId: fq.lines[k].id, costMinor: Math.round(costCny / rate), costCny, factory: f });
      }
    }
    if (!o.revisions?.length) return;

    const quotation = await db.quotation.create({ data: { refNo: await nextReference(db, "quotation", year), inquiryId: inquiry.id } });
    let accepted: { id: string; total: number; lines: Awaited<ReturnType<typeof db.quoteLine.findMany>> } | null = null;
    for (const [n, status] of o.revisions.entries()) {
      const margin = 18 - n * 3; // each revision a little sharper
      const lines = o.lines.map((l, i) => {
        const cost = costByLine.get(i);
        const unitPrice = cost ? priceForMargin(cost.costMinor, margin) : toMinor(l.factoryPrice);
        return { l, i, unitPrice, cost };
      });
      const totals = documentTotals(lines.map((x) => ({ quantity: x.l.quantity, unitPrice: fromMinor(x.unitPrice) })), 0);
      const header = { subtotal: fromMinor(totals.subtotal), total: fromMinor(totals.total) };
      const rev = await db.quotationRevision.create({
        data: {
          quotationId: quotation.id,
          number: n + 1,
          status,
          validUntil: toDbDate(addDays(created, 20 + n * 5)),
          sentOn: toDbDate(addDays(created, 4 + n * 3)),
          answeredOn: status === "accepted" || status === "rejected" ? toDbDate(addDays(created, 6 + n * 3)) : null,
          ...header,
          balanceTerms: o.order?.terms ?? "before_shipment",
          createdById: o.assignee ?? people.staff.id,
        },
      });
      // One option: the offer the goods came from (demo deals use one factory each), plus our charges.
      const option = await db.quotationOption.create({
        data: {
          revisionId: rev.id,
          letter: "A",
          factoryQuoteId: offerOf.get(o.lines.find((l) => l.type !== "charge")!.factory) ?? null,
          status: status === "accepted" ? "accepted" : "open",
          leadTime: "35 days after deposit",
          ...header,
          lines: {
            create: lines.map((x, k) => ({
              revisionId: rev.id,
              requestedItemId: x.l.type === "charge" ? null : inquiry.items[x.i]?.id,
              type: x.l.type ?? "goods",
              description: x.l.description,
              model: x.l.model,
              quantity: x.l.quantity,
              unit: x.l.unit ?? "pcs",
              unitPrice: fromMinor(x.unitPrice),
              lineTotal: fromMinor(totals.lines[k].lineTotal),
              unitCost: x.cost ? fromMinor(x.cost.costMinor) : null,
              factoryQuoteLineId: x.cost?.lineId,
              fxRate: x.cost ? rate : null,
              sortOrder: k,
            })),
          },
        },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (status === "accepted") accepted = { id: rev.id, total: totals.total, lines: option.lines };
    }
    if (!accepted || !o.order) return;

    const orderedOn = addDays(created, 6);
    const terms = o.order.terms ?? "before_shipment";
    const shippedOn = o.order.shippedAfterDays === undefined ? null : addDays(orderedOn, o.order.shippedAfterDays);
    const stageSince = o.order.stage === "confirmed" ? orderedOn : o.order.stage === "in_production" ? addDays(orderedOn, 5) : o.order.stage === "shipped" ? shippedOn! : addDays(shippedOn ?? orderedOn, 10);
    const order = await db.order.create({
      data: {
        refNo: await nextReference(db, "order", year),
        inquiryId: inquiry.id,
        revisionId: accepted.id,
        customerId: customer.id,
        status: o.order.stage === "done" ? "closed" : "open",
        stage: o.order.stage,
        stageSince: new Date(`${stageSince}T09:00:00Z`),
        closedAt: o.order.stage === "done" ? new Date(`${stageSince}T09:00:00Z`) : null,
        orderedOn: toDbDate(orderedOn),
        readyOn: o.order.readyInDays === undefined ? null : toDbDate(addDays(orderedOn, o.order.readyInDays)),
        shippedOn: shippedOn ? toDbDate(shippedOn) : null,
        blNo: shippedOn ? `QDLOS${blSerial++}` : null,
        currency: "USD",
        total: fromMinor(accepted.total),
        depositPercent: 30,
        balanceTerms: terms,
        incoterm: "FOB",
        incotermPlace: "Qingdao",
        createdById: people.manager.id,
        // The accepted lines, frozen on the order (as the API does on acceptance).
        lines: {
          create: accepted.lines.map((l) => ({
            quoteLineId: l.id,
            type: l.type,
            description: l.description,
            model: l.model,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            unitCost: l.unitCost,
            sortOrder: l.sortOrder,
            // Goods that already left came in from the factory and were packed.
            ...(shippedOn && l.type === "goods"
              ? { receivedQty: l.quantity, receivedOn: toDbDate(addDays(shippedOn, -5)), packages: Math.max(1, Math.ceil(Number(l.quantity) / 50)), packageType: "Carton", netWeightKg: "480.00", grossWeightKg: "512.50", cbm: "2.400" }
              : {}),
          })),
        },
        ...(shippedOn ? { packedAt: new Date(`${addDays(shippedOn, -2)}T09:00:00Z`), containerNo: "TGHU 882741-3", shippingMarks: `${customer.name.toUpperCase()}\nMADE IN CHINA` } : {}),
      },
    });
    // Its history: each stage it went through, in order.
    const flow: OrderStage[] = ["confirmed", "in_production", "shipped", "done"];
    for (const [i, st] of flow.slice(0, flow.indexOf(o.order.stage) + 1).entries()) {
      const at = st === "confirmed" ? orderedOn : st === "in_production" ? addDays(orderedOn, 5) : st === "shipped" ? shippedOn! : stageSince;
      await db.orderStageChange.create({ data: { orderId: order.id, fromStage: i === 0 ? null : flow[i - 1], toStage: st, byId: i === 0 ? people.manager.id : o.assignee ?? people.manager.id, at: new Date(`${at}T09:00:00Z`) } });
    }
    // The customer's plan from the terms; the balance is dated once shipped.
    for (const [k, p] of defaultPlan(accepted.total, 30, orderedOn, 7).entries()) {
      await db.paymentPlanItem.create({ data: { orderId: order.id, label: p.label, amount: fromMinor(p.amountMinor), dueOn: p.dueOn ? toDbDate(p.dueOn) : shippedOn ? toDbDate(addDays(shippedOn, 14)) : null, sortOrder: k } });
    }
    // What we paid the factories: 30% once production started, the rest before shipping (CNY, with tax).
    const owed = new Map<number, number>();
    for (const [i, l] of o.lines.entries()) {
      const c = costByLine.get(i);
      if (c) owed.set(c.factory, (owed.get(c.factory) ?? 0) + Math.round(c.costCny * Number(l.quantity)));
    }
    for (const [f, cny] of owed) {
      const pay = async (kind: "deposit" | "balance", minor: number, on: string) =>
        db.factoryPayment.create({ data: { orderId: order.id, factoryId: factories[f].id, kind, amount: fromMinor(minor), currency: "CNY", rate, paidOn: toDbDate(on), reference: `FP-DEMO-${kind}`, recordedById: people.manager.id, paidById: o.assignee ?? people.manager.id } });
      if (o.order.stage !== "confirmed") await pay("deposit", Math.round(cny * 0.3), addDays(orderedOn, 6));
      if (shippedOn) await pay("balance", cny - Math.round(cny * 0.3), addDays(shippedOn, -3));
    }
    if (shippedOn) {
      await db.expense.create({ data: { orderId: order.id, category: "inland_transport", description: "Truck from the factory to Qingdao port", amount: "3200.00", currency: "CNY", rate, spentOn: toDbDate(addDays(shippedOn, -2)), paidById: o.assignee ?? people.manager.id, recordedById: people.manager.id } });
      await db.expense.create({ data: { orderId: order.id, category: "inspection", description: "Pre-shipment inspection", amount: "280.00", currency: "USD", rate: 1, spentOn: toDbDate(addDays(shippedOn, -4)), recordedById: people.manager.id } });
    }
    const { deposit, balance } = splitDeposit(accepted.total, 30);
    if (o.order.paid !== "none") {
      await db.payment.create({
        data: { kind: "deposit", orderId: order.id, customerId: customer.id, amount: fromMinor(deposit - 2500), bankCharges: "25.00", currency: "USD", paidOn: toDbDate(addDays(orderedOn, 4)), reference: "TT-DEMO-1", recordedById: people.manager.id },
      });
    }
    if (o.order.paid === "full") {
      await db.payment.create({
        data: { kind: "balance", orderId: order.id, customerId: customer.id, amount: fromMinor(balance), currency: "USD", paidOn: toDbDate(addDays(shippedOn ?? orderedOn, 3)), reference: "TT-DEMO-2", recordedById: people.manager.id },
      });
    }
  }

  let blSerial = 240_118;
  await deal({ customer: 0, stage: "new", category: "Machinery", daysAgo: 0, lines: [{ description: "Rotary tablet press, 35 stations", quantity: 1, factoryPrice: 0, factory: 0 }] });
  await deal({ customer: 3, stage: "new", category: "Chemicals", daysAgo: 3, lines: [{ description: "Urea 46% granular", quantity: 50, unit: "ton", factoryPrice: 0, factory: 2 }] });
  await deal({ customer: 1, assignee: bilal.id, stage: "sourcing", category: "Machinery", daysAgo: 2, lines: [{ description: "Gate valve DN100 PN16", quantity: 120, factoryPrice: 410, factory: 1 }] });
  await deal({ customer: 2, assignee: sana.id, stage: "quoted", category: "Building materials", daysAgo: 8, revisions: ["sent"], lines: [{ description: "PVC pipe 110mm, 6m", quantity: 800, factoryPrice: 58, factory: 2 }] });
  await deal({ customer: 0, assignee: bilal.id, stage: "quoted", category: "Machinery", daysAgo: 12, revisions: ["superseded", "sent"], lines: [{ description: "Blister packing machine DPP-260", quantity: 1, factoryPrice: 98000, factory: 0 }, { description: "Sea freight to Lagos", quantity: 1, factoryPrice: 2400, factory: 0, type: "charge" }] });
  await deal({ customer: 1, assignee: sana.id, stage: "lost", lostReason: "price_too_high", category: "Packaging", daysAgo: 20, revisions: ["rejected"], lines: [{ description: "Shrink film 25 micron", quantity: 10, unit: "ton", factoryPrice: 11000, factory: 2 }] });
  await deal({
    customer: 0, assignee: bilal.id, stage: "won", category: "Machinery", daysAgo: 25, revisions: ["superseded", "accepted"],
    order: { stage: "in_production", paid: "deposit", readyInDays: 15 },
    lines: [{ description: "Capsule filling machine NJP-1200", quantity: 2, factoryPrice: 125000, factory: 0 }, { description: "Spare parts kit", quantity: 2, factoryPrice: 6000, factory: 0 }],
  });
  await deal({
    customer: 2, assignee: sana.id, stage: "won", category: "Machinery", daysAgo: 30, revisions: ["accepted"],
    order: { stage: "confirmed", paid: "none", terms: "against_bl_copy" },
    lines: [{ description: "Butterfly valve DN200", quantity: 60, factoryPrice: 780, factory: 1 }],
  });
  await deal({
    customer: 3, assignee: bilal.id, stage: "won", category: "Packaging", daysAgo: 90, revisions: ["accepted"],
    order: { stage: "done", paid: "full", shippedAfterDays: 35 },
    lines: [{ description: "Woven PP bags 50kg", quantity: 100000, factoryPrice: 1.15, factory: 2 }],
  });
  await deal({
    customer: 1, assignee: sana.id, stage: "won", category: "Machinery", daysAgo: 60, revisions: ["accepted"],
    order: { stage: "shipped", paid: "deposit", terms: "against_bl_copy", shippedAfterDays: 38 },
    lines: [{ description: "Ball valve DN50, stainless", quantity: 300, factoryPrice: 165, factory: 1 }],
  });
  // Company costs for the last two months.
  for (const back of [0, 1]) {
    const on = addDays(today, -back * 30);
    await db.expense.create({ data: { category: "rent", description: "Office rent, Jining", amount: "8000.00", currency: "CNY", rate, spentOn: toDbDate(on), recordedById: people.manager.id } });
    await db.expense.create({ data: { category: "office", description: "Phone and internet", amount: "450.00", currency: "CNY", rate, spentOn: toDbDate(on), recordedById: people.manager.id } });
  }
  console.log("[seed] demo data created: 4 customers, 3 factories, 10 deals (orders: 1 confirmed, 1 in production, 1 shipped, 1 done)");
  console.log("[seed] demo people bilal@example.com / sana@example.com, password Demo@12345");
}

async function main() {
  const people = await seedBase();
  if (demo) await demoData(prisma, people);
  console.log("[seed] done");
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
