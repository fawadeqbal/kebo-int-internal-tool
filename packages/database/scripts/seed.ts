/**
 * Seed: the starting accounts and settings; with --demo, sample deals at every
 * stage (for development only — refused against a non-local database).
 *
 *   pnpm db:seed            accounts + settings (safe to run again)
 *   pnpm db:seed --demo     plus sample customers, factories and deals
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { documentTotals, fromMinor, splitDeposit, unitCostMinor, priceForMargin, toMinor } from "@kebo/money";
import { initialStates, readSettings, SETTINGS, type BalanceTerms, type MilestoneKey, type SettingsKey } from "@kebo/shared";
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
    order?: { done: MilestoneKey[]; terms?: BalanceTerms; shipInDays?: number };
  }) {
    const created = addDays(today, -o.daysAgo);
    const customer = customers[o.customer];
    const inquiry = await db.inquiry.create({
      data: {
        refNo: await nextReference(db, "inquiry"),
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

    // Factory prices (CNY, VAT included) for each goods line.
    const costByLine = new Map<number, { lineId: string; costMinor: number }>();
    for (const [i, l] of o.lines.entries()) {
      if (l.type === "charge") continue;
      const fq = await db.factoryQuote.create({
        data: {
          inquiryId: inquiry.id,
          factoryId: factories[l.factory].id,
          receivedOn: toDbDate(addDays(created, 2)),
          currency: "CNY",
          createdById: o.assignee ?? people.staff.id,
          lines: { create: { requestedItemId: inquiry.items[i]?.id, description: l.description, quantity: l.quantity, unit: l.unit ?? "pcs", unitPrice: l.factoryPrice, vatRate: 13 } },
        },
        include: { lines: true },
      });
      const costCny = unitCostMinor({ unitPriceMinor: toMinor(l.factoryPrice), vatRate: 13, pricesIncludeVat: true });
      costByLine.set(i, { lineId: fq.lines[0].id, costMinor: Math.round(costCny / rate) });
    }
    if (!o.revisions?.length) return;

    const quotation = await db.quotation.create({ data: { refNo: await nextReference(db, "quotation"), inquiryId: inquiry.id } });
    let accepted: { id: string; total: number; lines: { id: string }[] } | null = null;
    for (const [n, status] of o.revisions.entries()) {
      const margin = 18 - n * 3; // each revision a little sharper
      const lines = o.lines.map((l, i) => {
        const cost = costByLine.get(i);
        const unitPrice = cost ? priceForMargin(cost.costMinor, margin) : toMinor(l.factoryPrice);
        return { l, i, unitPrice, cost };
      });
      const totals = documentTotals(lines.map((x) => ({ quantity: x.l.quantity, unitPrice: fromMinor(x.unitPrice) })), 0);
      const rev = await db.quotationRevision.create({
        data: {
          quotationId: quotation.id,
          number: n + 1,
          status,
          validUntil: toDbDate(addDays(created, 20 + n * 5)),
          sentOn: toDbDate(addDays(created, 4 + n * 3)),
          answeredOn: status === "accepted" || status === "rejected" ? toDbDate(addDays(created, 6 + n * 3)) : null,
          subtotal: fromMinor(totals.subtotal),
          total: fromMinor(totals.total),
          balanceTerms: o.order?.terms ?? "before_shipment",
          createdById: o.assignee ?? people.staff.id,
          lines: {
            create: lines.map((x, k) => ({
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
        include: { lines: true },
      });
      if (status === "accepted") accepted = { id: rev.id, total: totals.total, lines: rev.lines };
    }
    if (!accepted || !o.order) return;

    const orderedOn = addDays(created, 6);
    const terms = o.order.terms ?? "before_shipment";
    const order = await db.order.create({
      data: {
        refNo: await nextReference(db, "order"),
        inquiryId: inquiry.id,
        revisionId: accepted.id,
        customerId: customer.id,
        orderedOn: toDbDate(orderedOn),
        shipBy: toDbDate(addDays(orderedOn, o.order.shipInDays ?? 45)),
        currency: "USD",
        total: fromMinor(accepted.total),
        depositPercent: 30,
        balanceTerms: terms,
        incoterm: "FOB",
        incotermPlace: "Qingdao",
        createdById: people.manager.id,
      },
    });
    const states = initialStates({ depositPercent: 30, balanceTerms: terms });
    let day = orderedOn;
    for (const [i, s] of states.entries()) {
      const done = o.order.done.includes(s.key);
      if (done) day = addDays(day, 2);
      await db.milestone.create({
        data: { orderId: order.id, key: s.key, sortOrder: i, status: done ? "done" : s.status, doneOn: done ? toDbDate(day) : null, doneById: done ? people.manager.id : null },
      });
    }
    const { deposit } = splitDeposit(accepted.total, 30);
    if (o.order.done.includes("customer_deposit")) {
      await db.payment.create({
        data: { direction: "in", kind: "deposit", orderId: order.id, customerId: customer.id, amount: fromMinor(deposit - 2500), bankCharges: "25.00", currency: "USD", paidOn: toDbDate(addDays(orderedOn, 4)), reference: "TT-DEMO-1", recordedById: people.manager.id },
      });
    }
    if (o.order.done.includes("factory_order")) {
      const fo = await db.factoryOrder.create({
        data: {
          refNo: await nextReference(db, "factoryOrder"),
          orderId: order.id,
          factoryId: factories[o.lines[0].factory].id,
          status: "confirmed",
          currency: "CNY",
          total: fromMinor(toMinor(o.lines[0].factoryPrice) * o.lines[0].quantity),
          sentOn: toDbDate(addDays(orderedOn, 6)),
          confirmedOn: toDbDate(addDays(orderedOn, 7)),
          createdById: people.manager.id,
          lines: { create: { description: o.lines[0].description, quantity: o.lines[0].quantity, unitPrice: o.lines[0].factoryPrice, lineTotal: fromMinor(toMinor(o.lines[0].factoryPrice) * o.lines[0].quantity) } },
        },
      });
      if (o.order.done.includes("factory_deposit")) {
        await db.payment.create({
          data: { direction: "out", kind: "deposit", orderId: order.id, factoryId: fo.factoryId, factoryOrderId: fo.id, amount: fromMinor(Math.round(toMinor(fo.total.toString()) * 0.3)), currency: "CNY", paidOn: toDbDate(addDays(orderedOn, 8)), recordedById: people.manager.id },
        });
      }
    }
    if (o.order.done.length === states.length) await db.order.update({ where: { id: order.id }, data: { status: "closed", closedAt: new Date() } });
  }

  const all: MilestoneKey[] = initialStates({ depositPercent: 30, balanceTerms: "before_shipment" }).map((s) => s.key);
  await deal({ customer: 0, stage: "new", category: "Machinery", daysAgo: 0, lines: [{ description: "Rotary tablet press, 35 stations", quantity: 1, factoryPrice: 0, factory: 0 }] });
  await deal({ customer: 3, stage: "new", category: "Chemicals", daysAgo: 3, lines: [{ description: "Urea 46% granular", quantity: 50, unit: "ton", factoryPrice: 0, factory: 2 }] });
  await deal({ customer: 1, assignee: bilal.id, stage: "sourcing", category: "Machinery", daysAgo: 2, lines: [{ description: "Gate valve DN100 PN16", quantity: 120, factoryPrice: 410, factory: 1 }] });
  await deal({ customer: 2, assignee: sana.id, stage: "quoted", category: "Building materials", daysAgo: 8, revisions: ["sent"], lines: [{ description: "PVC pipe 110mm, 6m", quantity: 800, factoryPrice: 58, factory: 2 }] });
  await deal({ customer: 0, assignee: bilal.id, stage: "quoted", category: "Machinery", daysAgo: 12, revisions: ["superseded", "sent"], lines: [{ description: "Blister packing machine DPP-260", quantity: 1, factoryPrice: 98000, factory: 0 }, { description: "Sea freight to Lagos", quantity: 1, factoryPrice: 2400, factory: 0, type: "charge" }] });
  await deal({ customer: 1, assignee: sana.id, stage: "lost", lostReason: "price_too_high", category: "Packaging", daysAgo: 20, revisions: ["rejected"], lines: [{ description: "Shrink film 25 micron", quantity: 10, unit: "ton", factoryPrice: 11000, factory: 2 }] });
  await deal({
    customer: 0, assignee: bilal.id, stage: "won", category: "Machinery", daysAgo: 25, revisions: ["superseded", "accepted"],
    order: { done: ["proforma_sent", "customer_deposit", "factory_order", "factory_deposit"] },
    lines: [{ description: "Capsule filling machine NJP-1200", quantity: 2, factoryPrice: 125000, factory: 0 }, { description: "Spare parts kit", quantity: 2, factoryPrice: 6000, factory: 0 }],
  });
  await deal({
    customer: 2, assignee: sana.id, stage: "won", category: "Machinery", daysAgo: 30, revisions: ["accepted"],
    order: { done: ["proforma_sent"], terms: "against_bl_copy", shipInDays: 30 },
    lines: [{ description: "Butterfly valve DN200", quantity: 60, factoryPrice: 780, factory: 1 }],
  });
  await deal({
    customer: 3, assignee: bilal.id, stage: "won", category: "Packaging", daysAgo: 90, revisions: ["accepted"],
    order: { done: all, shipInDays: 30 },
    lines: [{ description: "Woven PP bags 50kg", quantity: 100000, factoryPrice: 1.15, factory: 2 }],
  });
  console.log("[seed] demo data created: 4 customers, 3 factories, 9 deals (2 orders in progress, 1 closed)");
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
