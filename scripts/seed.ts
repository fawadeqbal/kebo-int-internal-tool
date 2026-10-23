/**
 * Seeds the database.
 *   - Always: the first Super Admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) and default settings.
 *   - With --demo (or SEED_DEMO=true): sample users, customers, queries, quotations,
 *     invoices and payments spread over the last 6 months, for demos and training.
 * Safe to run more than once: it skips anything that already exists.
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import { calculateTotals, fromCents } from "../src/lib/utils/money";
import { DEFAULT_SETTINGS } from "../src/modules/settings/service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const {
  users,
  customers,
  queries,
  queryStatusHistory,
  queryAssignments,
  comments,
  quotations,
  quotationItems,
  invoices,
  invoiceItems,
  payments,
  settings,
  counters,
  auditLogs,
} = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function nextRef(tx: Tx, prefix: string, year: number) {
  const key = `${prefix}-${year}`;
  const [row] = await tx
    .insert(counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${key}-${String(row.value).padStart(4, "0")}`;
}

/** Deterministic pseudo-random numbers so the demo data is the same every time. */
let seed = 20261023;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600000);

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    console.log(`[seed] admin ${email} already exists`);
    return existing.id;
  }
  const [created] = await db
    .insert(users)
    .values({ name: "System Admin", email, role: "admin", passwordHash: await bcrypt.hash(password, 12) })
    .returning({ id: users.id });
  console.log(`[seed] created admin ${email}`);
  return created.id;
}

async function seedSettings() {
  // NOTIFY_EMAILS (comma separated) pre-fills Settings → Email notifications on first setup.
  const notifyEmails = (process.env.NOTIFY_EMAILS ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  await db.insert(settings).values({ key: "app", value: { ...DEFAULT_SETTINGS, notifyEmails } }).onConflictDoNothing();
}

/** Fictional overseas buyers: [contact person, company (optional), phone, email, address]. */
const COMPANIES = [
  ["Imran Qureshi", "Medipak Pharma (Pvt) Ltd", "+92 300 5123456", "imran@medipak.example", "Sundar Industrial Estate, Lahore, Pakistan"],
  ["Dr. Hina Farooq", "Crescent Life Sciences", "+92 321 4455667", "hina@crescentls.example", "I-9 Industrial Area, Islamabad, Pakistan"],
  ["Chinedu Okafor", "Lagos Health Industries Ltd", "+234 803 555 0142", "chinedu@lagoshealth.example", "Ikeja, Lagos, Nigeria"],
  ["Amina Mwangi", "Nairobi Juice Co.", "+254 722 555 019", "amina@nairobijuice.example", "Industrial Area, Nairobi, Kenya"],
  ["Khalid Al-Harbi", "Gulf Cosmetics Factory", "+966 55 555 0187", "khalid@gulfcosmetics.example", "Second Industrial City, Riyadh, Saudi Arabia"],
  ["Rashed Hossain", "Dhaka Textiles Ltd", "+880 1711 555 210", "rashed@dhakatex.example", "Gazipur, Dhaka, Bangladesh"],
  ["Omar Farid", null, "+20 100 555 0193", "omar.farid@mail.example", "Cairo, Egypt"],
  ["Dilshod Karimov", "Tashkent MedLab", "+998 90 555 0136", "dilshod@tashkentmedlab.example", "Tashkent, Uzbekistan"],
  ["Fatima Zahra Benali", "Atlas Food Processing", "+212 661 555 024", "fz.benali@atlasfood.example", "Casablanca, Morocco"],
  ["Ahmed Raza", null, "+971 50 555 0178", "ahmed.raza@mail.example", "Sharjah, UAE"],
] as const;

/** Sample requests in the same categories as the website form; prices in USD. */
const JOBS = [
  { category: "Pharmaceutical Machinery", title: "Rotary tablet press, 35 stations", spec: "D-tooling, 35 stations, up to 250,000 tablets/hour. GMP model, SS316 contact parts, force feeder, PLC/HMI. Need IQ/OQ documents.", price: 68_000 },
  { category: "Pharmaceutical Machinery", title: "Automatic capsule filling machine", spec: "Size 0–4 change parts, 25,000 capsules/hour, dust extraction and empty-capsule rejection.", price: 54_000 },
  { category: "Pharmaceutical Machinery", title: "Alu-PVC blister packing machine", spec: "Flat-plate type, 40 cycles/min, batch coding and missing-tablet detection.", price: 79_000 },
  { category: "Medical Devices & Equipment", title: "Hospital bed set, 50 units", spec: "Electric 3-function ICU beds with side rails and mattresses. CE certified. Delivery to port in 60 days.", price: 1_150 },
  { category: "Laboratory Equipment", title: "HPLC system for QC lab", spec: "Quaternary pump, UV detector, autosampler, software and installation. 220V 50Hz.", price: 32_000 },
  { category: "Food Processing Machinery", title: "Fruit juice processing line, 2 t/h", spec: "Washing, crushing, pulping, pasteurising and hot filling for mango and orange juice. 2 tons per hour.", price: 145_000 },
  { category: "Beverage Machinery", title: "Water bottling line, 6,000 bph", spec: "Rinsing, filling, capping 3-in-1 machine for 500 ml PET bottles, with labeller and shrink wrapper.", price: 88_000 },
  { category: "Cosmetics Manufacturing Machinery", title: "Vacuum emulsifying mixer, 200 L", spec: "Homogenizer for creams and lotions, hydraulic lift, SS316L, with oil and water phase tanks.", price: 26_500 },
  { category: "Utility & HVAC Systems", title: "Clean room HVAC for 400 m² pharma area", spec: "AHUs, HEPA filters, ducting and BMS for Grade C/D rooms. Need layout drawing and quote.", price: 210_000 },
  { category: "Textile Machinery", title: "Air-jet looms, 24 units", spec: "190 cm reed width, 1,000 rpm, dobby shedding. Installation and training included.", price: 23_500 },
  { category: "Solar System Solutions", title: "500 kW rooftop solar system", spec: "Mono PERC panels, string inverters, mounting structure and monitoring for a factory roof.", price: 265_000 },
  { category: "General Order Supply", title: "Spare motors and gearboxes", spec: "Assorted 3-phase motors 5.5–22 kW and matching gearboxes, list attached by email.", price: 9_800 },
] as const;

async function seedDemo(adminId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(queries);
  if (n > 0) {
    console.log("[seed] demo data skipped — queries already exist");
    return;
  }
  const demoPassword = await bcrypt.hash(process.env.SEED_DEMO_PASSWORD ?? "Demo@12345", 12);
  const people = [
    { name: "Ayesha Khan", email: "ayesha@example.com", role: "manager" as const },
    { name: "Bilal Ahmed", email: "bilal@example.com", role: "staff" as const },
    { name: "Sana Malik", email: "sana@example.com", role: "staff" as const },
    { name: "Usman Tariq", email: "usman@example.com", role: "staff" as const },
  ];
  const staff: Record<string, string> = {};
  for (const p of people) {
    const [row] = await db
      .insert(users)
      .values({ ...p, passwordHash: demoPassword })
      .onConflictDoUpdate({ target: users.email, set: { name: p.name } })
      .returning({ id: users.id });
    staff[p.name] = row.id;
  }
  const manager = staff["Ayesha Khan"];
  const workers = [staff["Bilal Ahmed"], staff["Sana Malik"], staff["Usman Tariq"]];

  const customerIds: string[] = [];
  for (const [contactPerson, companyName, phone, email, address] of COMPANIES) {
    const [row] = await db
      .insert(customers)
      .values({ companyName, contactPerson, phone, email, address, createdBy: manager, createdAt: addDays(new Date(), -200) })
      .returning({ id: customers.id });
    customerIds.push(row.id);
  }

  const now = new Date();
  const sources = ["website", "website", "whatsapp", "email", "website", "phone"] as const;
  const priorities = ["normal", "normal", "high", "low", "urgent", "normal"] as const;
  const TOTAL = 34;

  for (let i = 0; i < TOTAL; i++) {
    // Spread over ~6 months, more recent ones more likely to be open.
    const ageDays = 175 * Math.pow(1 - i / TOTAL, 1.7) + rand() * 2;
    const created = addHours(addDays(now, -Math.max(0.2, ageDays)), -Math.floor(rand() * 6));
    const age = (now.getTime() - created.getTime()) / 86400000;
    const job = pick(JOBS);
    const customerId = pick(customerIds);
    const assignee = rand() < 0.88 ? pick(workers) : null;
    const quantity = job.title.startsWith("Hospital bed") ? 50 : job.title.startsWith("Air-jet") ? 24 : 1;
    const requiredBy = iso(addDays(created, 10 + Math.floor(rand() * 30)));

    // Decide where this query ended up.
    let outcome: "pending" | "processing" | "quoted_draft" | "sent" | "rejected" | "accepted" | "invoiced" | "paid" | "partial" | "not_completed";
    const r = rand();
    if (age < 3) outcome = r < 0.65 ? "pending" : "processing";
    else if (age < 20) outcome = r < 0.15 ? "pending" : r < 0.5 ? "processing" : r < 0.65 ? "quoted_draft" : r < 0.9 ? "sent" : "accepted";
    else outcome = r < 0.1 ? "not_completed" : r < 0.22 ? "rejected" : r < 0.3 ? "sent" : r < 0.45 ? "invoiced" : r < 0.6 ? "partial" : "paid";

    await db.transaction(async (tx) => {
      const refNo = await nextRef(tx, "QRY", created.getUTCFullYear());
      const hist: { from: schema.QueryStatus | null; to: schema.QueryStatus; at: Date; reason?: string }[] = [{ from: null, to: "pending", at: created }];
      const startAt = addHours(created, 6 + rand() * 40);
      let status: schema.QueryStatus = "pending";
      let completedAt: Date | null = null;
      let reason: string | null = null;
      if (outcome !== "pending") {
        hist.push({ from: "pending", to: "processing", at: startAt });
        status = "processing";
      }
      if (outcome === "not_completed") {
        completedAt = addDays(startAt, 3 + rand() * 5);
        reason = pick(["Customer bought locally", "Budget not approved by customer", "Specification not feasible"]);
        hist.push({ from: "processing", to: "not_completed", at: completedAt, reason });
        status = "not_completed";
      }
      if (["paid", "rejected"].includes(outcome)) {
        completedAt = addDays(startAt, 8 + rand() * 14);
        if (outcome === "rejected") {
          reason = "Customer rejected the quotation (price)";
          hist.push({ from: "processing", to: "not_completed", at: completedAt, reason });
          status = "not_completed";
        } else {
          hist.push({ from: "processing", to: "completed", at: completedAt });
          status = "completed";
        }
      }

      const [q] = await tx
        .insert(queries)
        .values({
          refNo,
          customerId,
          source: pick(sources),
          title: job.title,
          category: job.category,
          specifications: job.spec,
          quantity,
          priority: pick(priorities),
          requiredBy,
          status,
          statusReason: reason,
          assignedTo: assignee,
          createdBy: rand() < 0.5 ? manager : (assignee ?? manager),
          completedAt,
          createdAt: created,
          updatedAt: completedAt ?? startAt,
        })
        .returning({ id: queries.id });

      for (const h of hist)
        await tx.insert(queryStatusHistory).values({ queryId: q.id, fromStatus: h.from, toStatus: h.to, reason: h.reason ?? null, changedBy: assignee ?? manager, changedAt: h.at });
      if (assignee) await tx.insert(queryAssignments).values({ queryId: q.id, assignedTo: assignee, assignedBy: manager, assignedAt: addHours(created, 1) });
      if (rand() < 0.6)
        await tx.insert(comments).values({
          queryId: q.id,
          authorId: assignee ?? manager,
          body: pick([
            "Called the customer to confirm the voltage and output requirement.",
            "Customer will share the layout drawing by email.",
            "Checked with the supplier — lead time is about 10 weeks.",
            "Customer asked for a demo video of the machine.",
          ]),
          createdAt: addHours(created, 20),
        });

      // Quotations
      if (["quoted_draft", "sent", "rejected", "accepted", "invoiced", "paid", "partial"].includes(outcome)) {
        const quotedAt = addDays(startAt, 2 + rand() * 4);
        const unit = Math.round((job.price * (0.9 + rand() * 0.25)) / 50) * 50;
        const lines = [{ description: `${job.title}\n${job.spec}`, quantity, unitPrice: unit }];
        if (job.category !== "General Order Supply")
          lines.push({ description: "Sea freight CIF destination port, incl. export documents", quantity: 1, unitPrice: Math.round((unit * quantity * 0.06) / 50) * 50 });
        const discount = rand() < 0.3 ? Math.round((unit * quantity * 0.02) / 50) * 50 : 0;
        const t = calculateTotals(lines, discount, 0);
        const qStatus: schema.QuotationStatus =
          outcome === "quoted_draft" ? "draft" : outcome === "sent" ? "sent" : outcome === "rejected" ? "rejected" : "accepted";
        const submittedAt = qStatus === "draft" ? null : iso(addDays(quotedAt, 1));
        const dueDate = iso(addDays(quotedAt, 15));
        const quoteRef = await nextRef(tx, "QUO", quotedAt.getUTCFullYear());
        const [quote] = await tx
          .insert(quotations)
          .values({
            refNo: quoteRef,
            queryId: q.id,
            version: 1,
            subtotal: fromCents(t.subtotal),
            discount: fromCents(t.discount),
            taxRate: "0",
            taxAmount: fromCents(t.taxAmount),
            total: fromCents(t.total),
            dueDate,
            submittedAt,
            status: qStatus,
            terms: DEFAULT_SETTINGS.defaultQuotationTerms,
            createdBy: assignee ?? manager,
            createdAt: quotedAt,
            updatedAt: quotedAt,
          })
          .returning({ id: quotations.id });
        await tx.insert(quotationItems).values(
          lines.map((l, idx) => ({
            quotationId: quote.id,
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            lineTotal: fromCents(t.lines[idx].lineTotal),
            sortOrder: idx,
          })),
        );

        // Invoices + payments
        if (["invoiced", "paid", "partial"].includes(outcome)) {
          const issue = addDays(quotedAt, 6 + rand() * 6);
          const issueDate = iso(issue > now ? now : issue);
          const invDue = iso(addDays(new Date(`${issueDate}T00:00:00Z`), 30));
          const invNo = await nextRef(tx, "INV", Number(issueDate.slice(0, 4)));
          const paid = outcome === "paid" ? t.total : outcome === "partial" ? Math.round(t.total * 0.5) : 0;
          const [inv] = await tx
            .insert(invoices)
            .values({
              invoiceNo: invNo,
              quotationId: quote.id,
              queryId: q.id,
              customerId,
              issueDate,
              dueDate: invDue,
              subtotal: fromCents(t.subtotal),
              discount: fromCents(t.discount),
              taxRate: "0",
              taxAmount: fromCents(t.taxAmount),
              total: fromCents(t.total),
              amountPaid: fromCents(paid),
              status: paid === 0 ? "unpaid" : paid >= t.total ? "paid" : "partially_paid",
              createdBy: manager,
              createdAt: new Date(`${issueDate}T10:00:00Z`),
            })
            .returning({ id: invoices.id });
          await tx.insert(invoiceItems).values(
            lines.map((l, idx) => ({
              invoiceId: inv.id,
              description: l.description,
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              lineTotal: fromCents(t.lines[idx].lineTotal),
              sortOrder: idx,
            })),
          );
          if (paid > 0) {
            const paidOn = addDays(new Date(`${issueDate}T00:00:00Z`), 5 + rand() * 20);
            await tx.insert(payments).values({
              invoiceId: inv.id,
              amount: fromCents(paid),
              paidAt: iso(paidOn > now ? now : paidOn),
              method: pick(["bank_transfer", "cheque", "bank_transfer"] as const),
              reference: `TRX-${Math.floor(100000 + rand() * 899999)}`,
              recordedBy: manager,
            });
          }
        }
      }
      await tx.insert(auditLogs).values({ userId: manager, action: "create", entityType: "query", entityId: q.id, summary: `Created query ${refNo} (demo data)`, createdAt: created });
    });
  }
  void adminId;
  console.log(`[seed] demo data created: ${people.length} users, ${COMPANIES.length} customers, ${TOTAL} queries`);
  console.log(`[seed] demo users sign in with password: ${process.env.SEED_DEMO_PASSWORD ?? "Demo@12345"}`);
}

async function main() {
  await seedSettings();
  const adminId = await seedAdmin();
  if (process.argv.includes("--demo") || process.env.SEED_DEMO === "true") await seedDemo(adminId);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed] failed", error);
  await pool.end();
  process.exit(1);
});
