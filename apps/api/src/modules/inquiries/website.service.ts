import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { UNKNOWN_COUNTRY } from "@kebo/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EventBus } from "../../common/events/event-bus";
import { InquiriesService } from "./inquiries.service";
import { RateLimiter, verifyTurnstile } from "../../common/http/rate-limit";

/**
 * The website form's field names are not ours to choose, so common spellings
 * are accepted: "Full Name", full_name, fullName, name… all map to fullName.
 */
const ALIASES: Record<string, string[]> = {
  fullName: ["fullname", "name", "yourname", "contactname", "contactperson"],
  email: ["email", "businessemail", "emailaddress", "workemail", "mail"],
  phone: ["phone", "phonewhatsapp", "whatsapp", "phonenumber", "mobile", "tel", "contactnumber"],
  company: ["company", "companyname", "organisation", "organization", "business"],
  country: ["country", "countrycode"],
  category: ["category", "sourcingcategory", "sourcingcategoryrequired", "sector", "product", "productcategory", "industry"],
  requirements: ["requirements", "detailedrequirements", "message", "details", "description", "inquiry", "enquiry", "comments"],
  honeypot: ["website", "url", "gotcha", "hp"],
  page: ["page", "pageurl", "source", "referrer"],
};

const squash = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const k = squash(key);
    for (const [field, names] of Object.entries(ALIASES)) {
      if ((names.includes(k) || k === field.toLowerCase()) && !(field in out)) out[field] = String(value).trim();
    }
  }
  for (const field of ["fullName", "email", "phone", "category", "requirements"]) out[field] ??= "";
  return out;
}

export const websiteInquiry = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name").max(120),
  email: z
    .email("Please enter a valid business email")
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .trim()
    .min(7, "Please enter a valid phone / WhatsApp number")
    .max(40)
    .regex(/^[+\d][\d\s\-()./]{6,}$/, "Please enter a valid phone / WhatsApp number"),
  company: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  country: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null)),
  category: z.string().trim().min(1, "Please choose a sourcing category").max(120),
  requirements: z.string().trim().min(5, "Please describe your requirements").max(10000),
  page: z.string().trim().max(500).optional(),
});
export type WebsiteInquiry = z.infer<typeof websiteInquiry>;

const digits = (v: string) => v.replace(/\D/g, "");

@Injectable()
export class WebsiteService {
  private readonly hits = new RateLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly inquiries: InquiriesService,
  ) {}

  /** Small in-memory limiter: per visitor, and an hourly cap for everyone. */
  limit(key: string, max: number, windowMs: number) {
    this.hits.check(key, max, windowMs, "Too many inquiries were sent. Please try again in a few minutes or contact us on WhatsApp.");
  }

  /** Cloudflare Turnstile ("not a robot"), when TURNSTILE_SECRET_KEY is set (refuses when Cloudflare cannot be reached). */
  human(token: unknown, ip: string): Promise<boolean> {
    return verifyTurnstile(token, ip);
  }

  /**
   * A website RFQ becomes a deal for a known customer (matched by a contact's
   * email or phone) or a new one. A public form never changes an existing
   * customer: differing details are written into the deal for staff to check.
   */
  async receive(input: WebsiteInquiry) {
    const system = await this.prisma.db.user.findFirst({ where: { isSystem: true, email: "website-form@system.local" } });
    if (!system) throw new Error("The website-form system user is missing (run the seed).");
    const phone = digits(input.phone);
    const { inquiry, events } = await this.prisma.tx(async (tx) => {
      const [match] = await tx.$queryRaw<
        { customer_id: string; contact_id: string; name: string; email: string | null; phone: string | null }[]
      >`
        select ct.customer_id, ct.id as contact_id, ct.name, ct.email, ct.phone
          from contacts ct join customers c on c.id = ct.customer_id
         where ct.deleted_at is null and c.deleted_at is null
           and (lower(ct.email) = ${input.email}
                or (length(${phone}) >= 7 and (regexp_replace(coalesce(ct.phone,''), '\\D', '', 'g') = ${phone} or regexp_replace(coalesce(ct.whatsapp,''), '\\D', '', 'g') = ${phone})))
         order by ct.is_primary desc
         limit 1`;
      let customerId: string;
      let contactId: string;
      let note = "";
      if (match) {
        customerId = match.customer_id;
        contactId = match.contact_id;
        const differs = [
          input.fullName !== match.name && `Name: ${input.fullName}`,
          input.email !== match.email?.toLowerCase() && `Email: ${input.email}`,
          phone !== digits(match.phone ?? "") && `Phone: ${input.phone}`,
          input.company && `Company: ${input.company}`,
        ].filter(Boolean);
        if (differs.length) note = `— Details on the website form (not saved to the customer; check before using):\n${differs.join("\n")}`;
      } else {
        const c = await tx.customer.create({
          data: {
            type: input.company ? "company" : "individual",
            name: input.company || input.fullName,
            country: input.country ?? UNKNOWN_COUNTRY,
            createdById: system.id,
            contacts: {
              create: {
                name: input.fullName,
                email: input.email,
                phone: input.phone.replace(/[^\d+]/g, ""),
                whatsapp: input.phone.replace(/[^\d+]/g, ""),
                isPrimary: true,
              },
            },
          },
          include: { contacts: true },
        });
        customerId = c.id;
        contactId = c.contacts[0].id;
        await this.audit.record(tx, {
          userId: system.id,
          action: "create",
          entityType: "customer",
          entityId: c.id,
          summary: `Added customer ${c.name} from the website form`,
        });
      }
      const firstLine =
        input.requirements
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean) ?? input.category;
      return this.inquiries.createRecord(
        tx,
        system.id,
        {
          customerId,
          contactId,
          channel: "website",
          category: input.category,
          title: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
          requirements: input.requirements,
          priority: "normal",
          requiredBy: null,
          assigneeId: null,
          // One free-text message: one item to split up later; the full text is kept as the requirements.
          items: [
            {
              id: null,
              parentId: null,
              partOf: null,
              description: firstLine.slice(0, 2000),
              model: null,
              quantity: 1,
              unit: "pcs",
              targetPrice: null,
            },
          ],
        },
        { channelNote: [note, input.page && `— Sent from ${input.page}`].filter(Boolean).join("\n\n") || undefined },
      );
    });
    await this.events.publish(...events);
    return { reference: inquiry.refNo };
  }
}
