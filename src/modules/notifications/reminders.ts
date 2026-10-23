import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoices, queries, quotations, settings as settingsTable } from "@/lib/db/schema";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { getMailer, renderEmail } from "@/lib/email";
import { formatMoney, toCents } from "@/lib/utils/money";
import { loadSettings, type AppSettings } from "@/modules/settings/service";
import { recordAudit } from "@/modules/audit/service";
import { insertNotifications, managerIds, type NewNotification } from "./repository";

/**
 * The reminder job. Runs on a schedule in the worker container.
 * Every reminder carries a dedupe key, so running it again the same day sends nothing twice.
 */
export async function runReminders(now = new Date()) {
  const settings = await loadSettings();
  const today = todayISO();
  const managers = await managerIds();
  const out: NewNotification[] = [];
  const notify = (userIds: (string | null | undefined)[], n: Omit<NewNotification, "userId">) => {
    for (const userId of new Set(userIds.filter((u): u is string => !!u))) out.push({ ...n, userId });
  };

  // 1. Queries pending too long
  const pendingCutoff = new Date(now.getTime() - settings.reminderPendingDays * 86400000);
  const stalePending = await db
    .select({ id: queries.id, refNo: queries.refNo, title: queries.title, assignedTo: queries.assignedTo })
    .from(queries)
    .where(and(isNull(queries.deletedAt), eq(queries.status, "pending"), lt(queries.createdAt, pendingCutoff)));
  for (const q of stalePending)
    notify([q.assignedTo, ...managers], {
      type: "reminder.pending",
      title: `${q.refNo} has been pending for over ${settings.reminderPendingDays} days`,
      body: q.title,
      link: `/queries/${q.id}`,
      dedupeKey: `pending:${q.id}:${today}`,
    });

  // 2. Queries processing too long
  const processingCutoff = new Date(now.getTime() - settings.reminderProcessingDays * 86400000);
  const slow = await db
    .select({ id: queries.id, refNo: queries.refNo, title: queries.title, assignedTo: queries.assignedTo })
    .from(queries)
    .where(
      and(
        isNull(queries.deletedAt),
        eq(queries.status, "processing"),
        sql`(select max(h.changed_at) from query_status_history h where h.query_id = ${queries.id} and h.to_status = 'processing') < ${processingCutoff}`,
      ),
    );
  for (const q of slow)
    notify([q.assignedTo], {
      type: "reminder.processing",
      title: `${q.refNo} has been processing for over ${settings.reminderProcessingDays} days`,
      body: q.title,
      link: `/queries/${q.id}`,
      dedupeKey: `processing:${q.id}:${today}`,
    });

  // 3. Queries due soon or overdue (required-by date)
  const soon = addDaysISO(today, settings.reminderDueSoonDays);
  const due = await db
    .select({ id: queries.id, refNo: queries.refNo, title: queries.title, assignedTo: queries.assignedTo, requiredBy: queries.requiredBy })
    .from(queries)
    .where(and(isNull(queries.deletedAt), inArray(queries.status, ["pending", "processing"]), lte(queries.requiredBy, soon)));
  for (const q of due) {
    const overdue = q.requiredBy! < today;
    notify(overdue ? [q.assignedTo, ...managers] : [q.assignedTo], {
      type: overdue ? "reminder.overdue" : "reminder.dueSoon",
      title: overdue ? `${q.refNo} is overdue (required by ${q.requiredBy})` : `${q.refNo} is due on ${q.requiredBy}`,
      body: q.title,
      link: `/queries/${q.id}`,
      dedupeKey: `${overdue ? "overdue" : "due"}:${q.id}:${today}`,
    });
  }

  // 4. Sent quotations: due soon → remind; past due → mark expired
  const quotes = await db
    .select({ id: quotations.id, refNo: quotations.refNo, dueDate: quotations.dueDate, createdBy: quotations.createdBy })
    .from(quotations)
    .where(and(isNull(quotations.deletedAt), eq(quotations.status, "sent"), lte(quotations.dueDate, soon)));
  for (const q of quotes) {
    if (q.dueDate < today) {
      await db.transaction(async (tx) => {
        await tx.update(quotations).set({ status: "expired" }).where(and(eq(quotations.id, q.id), eq(quotations.status, "sent")));
        await recordAudit(tx, { userId: null, action: "status_change", entityType: "quotation", entityId: q.id, summary: `${q.refNo}: Sent → Expired (due date passed)` });
      });
      notify([q.createdBy, ...managers], {
        type: "reminder.quotationExpired",
        title: `Quotation ${q.refNo} expired without a reply`,
        link: `/quotations/${q.id}`,
        dedupeKey: `quote-expired:${q.id}`,
      });
    } else {
      notify([q.createdBy], {
        type: "reminder.quotationDue",
        title: `Quotation ${q.refNo} is valid until ${q.dueDate}. Follow up with the buyer`,
        link: `/quotations/${q.id}`,
        dedupeKey: `quote-due:${q.id}:${today}`,
      });
    }
  }

  // 5. Invoices due soon / overdue
  const unpaid = await db
    .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, dueDate: invoices.dueDate, createdBy: invoices.createdBy })
    .from(invoices)
    .where(and(inArray(invoices.status, ["unpaid", "partially_paid"]), lte(invoices.dueDate, soon)));
  for (const inv of unpaid) {
    const overdue = inv.dueDate < today;
    notify([inv.createdBy, ...managers], {
      type: overdue ? "reminder.invoiceOverdue" : "reminder.invoiceDue",
      title: overdue ? `Invoice ${inv.invoiceNo} is overdue (due ${inv.dueDate})` : `Invoice ${inv.invoiceNo} is due on ${inv.dueDate}`,
      link: `/invoices/${inv.id}`,
      dedupeKey: `${overdue ? "inv-overdue" : "inv-due"}:${inv.id}:${today}`,
    });
  }

  const created = await insertNotifications(db, out);
  const summarySent = await sendDailySummary(settings, now);
  return { checked: out.length, created, summarySent };
}

const SUMMARY_KEY = "daily-summary-sent";
const SUMMARY_HOUR = Number(process.env.DAILY_SUMMARY_HOUR ?? 8);

/** One email per day to the admin list: what is new, overdue and unpaid. */
async function sendDailySummary(settings: AppSettings, now: Date): Promise<boolean> {
  if (!settings.notifyDailySummary || settings.notifyEmails.length === 0) return false;
  const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  if (hour < SUMMARY_HOUR) return false;
  const today = todayISO();
  const [last] = await db.select().from(settingsTable).where(eq(settingsTable.key, SUMMARY_KEY));
  if (last?.value === today) return false;

  const open = await db
    .select({ id: queries.id, refNo: queries.refNo, title: queries.title, status: queries.status, requiredBy: queries.requiredBy, createdAt: queries.createdAt, customer: sql<string>`coalesce(${customers.companyName}, ${customers.contactPerson})` })
    .from(queries)
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .where(and(isNull(queries.deletedAt), inArray(queries.status, ["pending", "processing"])));
  const since = new Date(now.getTime() - 86400000);
  const fresh = open.filter((q) => q.createdAt > since);
  const overdue = open.filter((q) => q.requiredBy && q.requiredBy < today);
  const unpaid = await db
    .select({ invoiceNo: invoices.invoiceNo, dueDate: invoices.dueDate, total: invoices.total, paid: invoices.amountPaid })
    .from(invoices)
    .where(and(inArray(invoices.status, ["unpaid", "partially_paid"]), lt(invoices.dueDate, today)));

  const lines = [
    `Pending: ${open.filter((q) => q.status === "pending").length}   Processing: ${open.filter((q) => q.status === "processing").length}   Overdue: ${overdue.length}`,
    "",
    `New RFQs in the last 24 hours (${fresh.length}):`,
    ...(fresh.length ? fresh.map((q) => `• ${q.refNo} — ${q.customer}: ${q.title}`) : ["• none"]),
    "",
    `Overdue inquiries (${overdue.length}):`,
    ...(overdue.length ? overdue.slice(0, 20).map((q) => `• ${q.refNo} — ${q.customer}: ${q.title} (due ${q.requiredBy})`) : ["• none"]),
    "",
    `Overdue invoices (${unpaid.length}):`,
    ...(unpaid.length ? unpaid.map((i) => `• ${i.invoiceNo} — ${formatMoney((toCents(i.total) - toCents(i.paid)) / 100, settings.currency)} due ${i.dueDate}`) : ["• none"]),
  ];
  const mail = renderEmail({
    heading: `Kebo RFQ Desk, ${today}`,
    body: lines.join("\n"),
    link: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/dashboard`,
    linkLabel: "Open dashboard",
    footer: settings.companyName,
  });
  try {
    await getMailer().send({ to: settings.notifyEmails, subject: `Daily summary: ${fresh.length} new RFQs, ${overdue.length} overdue`, ...mail });
  } catch (error) {
    console.error("[reminders] daily summary email failed", error);
    return false;
  }
  await db
    .insert(settingsTable)
    .values({ key: SUMMARY_KEY, value: today })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: today, updatedAt: new Date() } });
  return true;
}
