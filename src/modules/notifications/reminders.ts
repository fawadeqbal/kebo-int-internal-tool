import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, queries, quotations, users } from "@/lib/db/schema";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { getMailer } from "@/lib/email";
import { loadSettings } from "@/modules/settings/service";
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
    .where(and(isNull(queries.deletedAt), inArray(queries.status, ["pending", "processing", "on_hold"]), lte(queries.requiredBy, soon)));
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
        title: `Quotation ${q.refNo} is valid until ${q.dueDate} — follow up with the customer`,
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

  // Optional email copy of each new reminder (only when SMTP is configured).
  if (created > 0 && process.env.SMTP_HOST) {
    const recipients = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.isActive, true));
    const mailer = getMailer();
    const appUrl = process.env.APP_URL ?? "";
    const byUser = new Map<string, NewNotification[]>();
    for (const n of out) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
    for (const [userId, list] of byUser) {
      const email = recipients.find((r) => r.id === userId)?.email;
      if (!email) continue;
      await mailer
        .send({
          to: email,
          subject: `${list.length} reminder${list.length > 1 ? "s" : ""} from ${settings.companyName}`,
          text: list.map((n) => `• ${n.title}${n.link ? `\n  ${appUrl}${n.link}` : ""}`).join("\n\n"),
        })
        .catch((e) => console.error("[reminders] email failed", e));
    }
  }
  return { checked: out.length, created };
}
