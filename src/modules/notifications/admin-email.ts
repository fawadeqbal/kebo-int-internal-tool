import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoices, queries, quotations, users } from "@/lib/db/schema";
import { getMailer, renderEmail } from "@/lib/email";
import { QUERY_STATUS_LABEL, QUOTATION_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { formatMoney } from "@/lib/utils/money";
import { loadSettings, type AppSettings } from "@/modules/settings/service";

type Topic = "notifyNewQuery" | "notifyClosed" | "notifyQuotation" | "notifyPayment" | "notifyDailySummary";

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");

/**
 * Email the admin notification list (Settings → Notifications) when the topic is switched on.
 * Never throws: a mail problem must not break the user's action.
 */
export async function emailAdmins(topic: Topic, build: (s: AppSettings) => Promise<{ subject: string; html: string; text: string; replyTo?: string } | null>) {
  try {
    const settings = await loadSettings();
    if (!settings[topic] || settings.notifyEmails.length === 0) return;
    const message = await build(settings);
    if (!message) return;
    await getMailer().send({ to: settings.notifyEmails, ...message });
  } catch (error) {
    console.error(`[email] ${topic} failed`, error);
  }
}

export function emailNewQuery(queryId: string) {
  return emailAdmins("notifyNewQuery", async (settings) => {
    const [row] = await db
      .select({ q: queries, c: customers })
      .from(queries)
      .innerJoin(customers, eq(customers.id, queries.customerId))
      .where(eq(queries.id, queryId));
    if (!row) return null;
    const { q, c } = row;
    const from = c.companyName ? `${c.contactPerson}, ${c.companyName}` : c.contactPerson;
    const mail = renderEmail({
      heading: `New ${q.refNo}${q.source === "website" ? " from the website" : ""}`,
      rows: [
        ["Buyer", from],
        ["Business email", c.email],
        ["Phone / WhatsApp", c.phone],
        ["Sourcing category", q.category],
        ["Received via", SOURCE_LABEL[q.source]],
      ],
      body: q.specifications,
      link: `${appUrl()}/queries/${q.id}`,
      linkLabel: "Open inquiry",
      footer: settings.companyName,
    });
    return { subject: `New ${q.refNo}: ${q.title}`, replyTo: c.email ?? undefined, ...mail };
  });
}

export function emailQueryClosed(queryId: string, actorId: string) {
  return emailAdmins("notifyClosed", async (settings) => {
    const [row] = await db
      .select({ q: queries, c: customers })
      .from(queries)
      .innerJoin(customers, eq(customers.id, queries.customerId))
      .where(eq(queries.id, queryId));
    if (!row || (row.q.status !== "completed" && row.q.status !== "not_completed")) return null;
    const { q, c } = row;
    const label = QUERY_STATUS_LABEL[q.status];
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
    const mail = renderEmail({
      heading: `${q.refNo} is ${label}`,
      rows: [
        ["Inquiry", q.title],
        ["Buyer", c.companyName || c.contactPerson],
        ["Closed by", actor?.name],
        ["Reason", q.statusReason],
      ],
      link: `${appUrl()}/queries/${q.id}`,
      linkLabel: "Open inquiry",
      footer: settings.companyName,
    });
    return { subject: `${q.refNo} ${label}: ${q.title}`, ...mail };
  });
}

export function emailQuotationDecision(quotationId: string) {
  return emailAdmins("notifyQuotation", async (settings) => {
    const [row] = await db
      .select({ qt: quotations, q: queries, c: customers })
      .from(quotations)
      .innerJoin(queries, eq(queries.id, quotations.queryId))
      .innerJoin(customers, eq(customers.id, queries.customerId))
      .where(eq(quotations.id, quotationId));
    if (!row || (row.qt.status !== "accepted" && row.qt.status !== "rejected")) return null;
    const { qt, q, c } = row;
    const label = QUOTATION_STATUS_LABEL[qt.status];
    const mail = renderEmail({
      heading: `Quotation ${qt.refNo} ${label.toLowerCase()} by the buyer`,
      rows: [
        ["Buyer", c.companyName || c.contactPerson],
        ["Inquiry", `${q.refNo}: ${q.title}`],
        ["Amount", formatMoney(qt.total, settings.currency)],
      ],
      link: `${appUrl()}/quotations/${qt.id}`,
      linkLabel: "Open quotation",
      footer: settings.companyName,
    });
    return { subject: `Quotation ${qt.refNo} ${label} — ${formatMoney(qt.total, settings.currency)}`, ...mail };
  });
}

export function emailPayment(invoiceId: string, amountText: string) {
  return emailAdmins("notifyPayment", async (settings) => {
    const [row] = await db
      .select({ inv: invoices, c: customers })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(eq(invoices.id, invoiceId));
    if (!row) return null;
    const { inv, c } = row;
    const mail = renderEmail({
      heading: `Payment received on ${inv.invoiceNo}`,
      rows: [
        ["Buyer", c.companyName || c.contactPerson],
        ["Amount", amountText],
        ["Invoice total", formatMoney(inv.total, settings.currency)],
        ["Paid so far", formatMoney(inv.amountPaid, settings.currency)],
      ],
      link: `${appUrl()}/invoices/${inv.id}`,
      linkLabel: "Open invoice",
      footer: settings.companyName,
    });
    return { subject: `Payment received: ${amountText} on ${inv.invoiceNo}`, ...mail };
  });
}
