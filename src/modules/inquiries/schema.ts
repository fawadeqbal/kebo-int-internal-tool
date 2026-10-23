import { z } from "zod";

/**
 * The website form's field names are not under our control, so common spellings
 * are accepted: "Full Name", full_name, fullName, name… all map to `fullName`.
 */
const ALIASES: Record<string, string[]> = {
  fullName: ["fullname", "name", "yourname", "contactname", "contactperson"],
  email: ["email", "businessemail", "emailaddress", "workemail", "mail"],
  phone: ["phone", "phonewhatsapp", "whatsapp", "phonenumber", "mobile", "tel", "contactnumber"],
  company: ["company", "companyname", "organisation", "organization", "business"],
  category: ["category", "sourcingcategory", "sourcingcategoryrequired", "sector", "product", "productcategory", "industry"],
  requirements: ["requirements", "detailedrequirements", "message", "details", "description", "inquiry", "enquiry", "comments"],
  honeypot: ["website", "url", "gotcha", "hp"],
  page: ["page", "pageurl", "source", "referrer"],
};

const squash = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeFields(raw: Record<string, unknown>): Record<string, string> {
  // Every field starts empty, so a missing one gets its friendly "please enter…" message.
  const out: Record<string, string> = {};
  const filled = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const k = squash(key);
    for (const [field, names] of Object.entries(ALIASES)) {
      if ((names.includes(k) || k === field.toLowerCase()) && !filled.has(field)) {
        out[field] = String(value).trim();
        filled.add(field);
      }
    }
  }
  for (const field of ["fullName", "email", "phone", "category", "requirements"]) out[field] ??= "";
  return out;
}

export const websiteInquirySchema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name").max(120),
  email: z.email("Please enter a valid business email").max(254).transform((v) => v.toLowerCase()),
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
  category: z.string().trim().min(1, "Please choose a sourcing category").max(120),
  requirements: z.string().trim().min(5, "Please describe your requirements").max(10000),
  page: z.string().trim().max(500).optional(),
});

export type WebsiteInquiry = z.infer<typeof websiteInquirySchema>;
