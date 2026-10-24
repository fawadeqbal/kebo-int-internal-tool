import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, users } from "@/lib/db/schema";
import { recordAudit } from "@/modules/audit/service";
import { normalizePhone } from "@/modules/customers/schema";
import { publish } from "@/modules/events";
import { insertQueryRecord } from "@/modules/queries/service";
import { titleFrom } from "@/modules/queries/schema";
import { loadSettings } from "@/modules/settings/service";
import type { WebsiteInquiry } from "./schema";

const WEBSITE_USER_EMAIL = "website-form@system.local";

/**
 * The "Website form" account that website inquiries are recorded under.
 * It is inactive, so nobody can sign in with it, and it never appears in staff lists.
 */
async function websiteUserId(): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, WEBSITE_USER_EMAIL)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(users)
    .values({ name: "Website form", email: WEBSITE_USER_EMAIL, role: "staff", isActive: false, passwordHash: "!disabled" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Website form" } })
    .returning({ id: users.id });
  return created.id;
}

/**
 * Turn a website RFQ into a customer (new, or matched by email / phone) and a Pending query.
 * Admins are notified through the normal "query.created" event (in-app + email).
 */
export async function receiveWebsiteInquiry(input: WebsiteInquiry) {
  const actorId = await websiteUserId();
  const settings = await loadSettings();
  const category = settings.categories.find((c) => c.toLowerCase() === input.category.toLowerCase()) ?? input.category;
  const phoneDigits = normalizePhone(input.phone);

  const query = await db.transaction(async (tx) => {
    // Same customer if the email or phone number is already known.
    const [match] = await tx
      .select()
      .from(customers)
      .where(
        and(
          isNull(customers.deletedAt),
          or(eq(customers.email, input.email), sql`regexp_replace(regexp_replace(${customers.phone}, '\\D', '', 'g'), '^92', '0') = ${phoneDigits}`),
        ),
      )
      .limit(1);

    let customerId: string;
    // Anyone can post the website form, so it never changes a customer record.
    // When the details differ from what we have, they go into the inquiry for staff to check.
    let contactNote = "";
    if (match) {
      customerId = match.id;
      const given = [
        input.fullName !== match.contactPerson && `Name: ${input.fullName}`,
        input.company && input.company !== match.companyName && `Company: ${input.company}`,
        input.email !== match.email && `Email: ${input.email}`,
        normalizePhone(input.phone) !== normalizePhone(match.phone) && `Phone: ${input.phone}`,
      ].filter(Boolean);
      if (given.length) contactNote = `\n\n— Contact details on the form (not saved to the customer; check before using):\n${given.join("\n")}`;
    } else {
      const [created] = await tx
        .insert(customers)
        .values({ companyName: input.company, contactPerson: input.fullName, email: input.email, phone: input.phone, createdBy: actorId })
        .returning({ id: customers.id });
      customerId = created.id;
      await recordAudit(tx, {
        userId: actorId,
        action: "create",
        entityType: "customer",
        entityId: customerId,
        summary: `Added customer ${input.company || input.fullName} from the website form`,
      });
    }

    return insertQueryRecord(tx, actorId, {
      customerId,
      source: "website",
      title: titleFrom(input.requirements, category),
      category,
      specifications: `${input.requirements}${contactNote}${input.page ? `\n\n— Sent from ${input.page}` : ""}`,
      quantity: 1,
      priority: "normal",
      requiredBy: null,
      assignedTo: null,
    });
  });

  await publish({ type: "query.created", queryId: query.id, refNo: query.refNo, title: query.title, actorId, source: "website" });
  return { refNo: query.refNo };
}
