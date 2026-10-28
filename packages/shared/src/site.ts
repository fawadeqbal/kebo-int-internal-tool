import { z } from "zod";
import { bool, optionalText, text } from "./schemas/common";

/* ---------------------------------------------------------------- the marketing site's words */

/** Icons a feature block may use (drawn by the web app). */
export const SITE_ICONS = [
  "inbox",
  "factory",
  "calculator",
  "file-text",
  "truck",
  "wallet",
  "chart",
  "users",
  "shield",
  "smartphone",
  "sheet",
  "globe",
  "clock",
  "bell",
] as const;
export type SiteIcon = (typeof SITE_ICONS)[number];

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email");
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\/\S+$/.test(v), "Use a full https:// address");

/**
 * Everything on the marketing page that the platform admin edits (Website in
 * the platform panel). The plans come from the plans themselves; here only
 * whether they show and which are left out.
 */
export const siteContent = z.object({
  hero: z.object({
    eyebrow: optionalText(80),
    title: text(120, "Write the headline"),
    subtitle: text(400, "Write a line under the headline"),
    primary: text(40, "Name the main button"),
    secondary: optionalText(40),
  }),
  features: z.object({
    title: text(120, "Give the section a title"),
    subtitle: optionalText(300),
    items: z
      .array(z.object({ icon: z.enum(SITE_ICONS), title: text(80, "Give the feature a title"), text: text(300, "Describe the feature") }))
      .max(12, "At most 12 features"),
  }),
  steps: z.object({
    title: text(120, "Give the section a title"),
    items: z.array(z.object({ title: text(80, "Give the step a title"), text: text(300, "Describe the step") })).max(6, "At most 6 steps"),
  }),
  plans: z.object({
    show: bool,
    title: text(120, "Give the section a title"),
    subtitle: optionalText(300),
    /** Plans left off the page. */
    hidden: z.array(z.uuid()).max(50),
    note: optionalText(300),
  }),
  quotes: z
    .array(
      z.object({
        text: text(500, "Write what they said"),
        name: text(80, "Whose words?"),
        role: optionalText(80),
        company: text(120, "Their company"),
      }),
    )
    .max(6, "At most 6 quotes"),
  faq: z.object({
    title: text(120, "Give the section a title"),
    items: z.array(z.object({ q: text(200, "Write the question"), a: text(1500, "Write the answer") })).max(20, "At most 20 questions"),
  }),
  cta: z.object({ title: text(120, "Write the closing headline"), text: optionalText(300) }),
  contact: z.object({ email: optionalEmail, whatsapp: optionalText(40), phone: optionalText(40) }),
  seo: z.object({
    title: text(70, "Write the page title (70 characters at most)"),
    description: text(200, "Write the description (200 characters at most)"),
    image: optionalUrl,
  }),
});
export type SiteContent = z.infer<typeof siteContent>;

/** What the page says until the platform admin publishes their own words. */
export const DEFAULT_SITE: SiteContent = {
  hero: {
    eyebrow: "For trading companies that source from factories",
    title: "Every RFQ, quotation and order in one place",
    subtitle:
      "RFQ Desk takes a customer's request from the first message to the shipped order: factory prices, your margin, the quotation, the proforma, payments and profit. Your whole team works from one screen.",
    primary: "Request a demo",
    secondary: "See the plans",
  },
  features: {
    title: "Built for how trading companies work",
    subtitle: "No spreadsheets passed around, no lost emails, no guessing what an order really earned.",
    items: [
      {
        icon: "inbox",
        title: "Inquiries that never get lost",
        text: "Every RFQ from email, WhatsApp or your website in one list, with who handles it and what happens next.",
      },
      {
        icon: "factory",
        title: "Factory prices side by side",
        text: "Ask several factories, compare their offers and keep every price for next time.",
      },
      {
        icon: "calculator",
        title: "Quotations with your margin",
        text: "Pick the offer, set the margin, and send a clean quotation in the customer's currency in minutes.",
      },
      {
        icon: "truck",
        title: "Orders from deposit to shipping",
        text: "Production, goods received, packing list and proforma invoice, stage by stage.",
      },
      {
        icon: "wallet",
        title: "Payments and profit per order",
        text: "Deposits, balances, factory payments and costs, so you see what each order really earned.",
      },
      { icon: "chart", title: "Insights for the owner", text: "Sales, margins, targets and who is winning, without building a report." },
    ],
  },
  steps: {
    title: "Up and running in a day",
    items: [
      { title: "Request a demo", text: "We set up a demo with sample inquiries and orders so you can try everything." },
      { title: "Bring your team", text: "Add your people, choose what each one may see, and import customers and factories from Excel." },
      { title: "Work from one place", text: "New RFQs, quotations and orders go through RFQ Desk, on the web and on the phone." },
    ],
  },
  plans: {
    show: true,
    title: "Simple plans",
    subtitle: "Pay per month. Change plans any time; nothing is lost when you do.",
    hidden: [],
    note: "Prices in USD. Need something different? Talk to us.",
  },
  quotes: [],
  faq: {
    title: "Questions",
    items: [
      { q: "Can I try it first?", a: "Yes. Request a demo and we set up a company with sample data for you to try for a few days." },
      {
        q: "Is our data kept apart from other companies?",
        a: "Yes. Every company's data is separated in the database itself, and each company has its own address.",
      },
      { q: "Does it work on the phone?", a: "Yes, there is a phone app for Android and iPhone on the plans that include it." },
      {
        q: "Can we bring our existing customers and factories?",
        a: "Yes. Upload them from an Excel file; the template shows what goes where.",
      },
    ],
  },
  cta: { title: "See it with your own inquiries", text: "Tell us a little about your company and we will set up a demo for you." },
  contact: { email: null, whatsapp: null, phone: null },
  seo: {
    title: "RFQ Desk: RFQs, quotations and orders for trading companies",
    description:
      "Every RFQ, factory price, quotation, order, payment and profit in one place. For trading companies that source from factories.",
    image: null,
  },
};

/* ---------------------------------------------------------------- where people come from */

/** Where a visitor or lead came from: campaign tags in the link, the site that sent them, the page and the button. */
export const leadOrigin = z
  .object({
    source: optionalText(80),
    medium: optionalText(80),
    campaign: optionalText(120),
    /** The referring site's host ("google.com"). */
    referrer: optionalText(200),
    page: optionalText(200),
    cta: optionalText(40),
  })
  .partial()
  .nullish()
  .transform((v) => v ?? null);
export type LeadOrigin = NonNullable<z.infer<typeof leadOrigin>>;

/** A host without the parts that do not tell sites apart ("www.", "m.", "l."). */
export const siteHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^(www|m|l|lm|mobile)\./, "");

/** One word to group by: the campaign's source, else the site that sent them, else "direct". */
export function channelOf(origin: Partial<LeadOrigin> | null | undefined): string {
  const source = origin?.source?.trim().toLowerCase();
  if (source) return source.slice(0, 80);
  const ref = origin?.referrer?.trim();
  if (ref) return siteHost(ref).slice(0, 80);
  return "direct";
}

const requiredEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => z.email().safeParse(v).success, "Enter a valid email");

/** Contact form ("Questions?" on the marketing page). */
export const siteContactInput = z.object({
  name: text(120, "Enter your name"),
  email: requiredEmail,
  companyName: optionalText(160),
  phone: optionalText(40),
  message: text(2000, "Write your question"),
  origin: leadOrigin,
  botToken: z.string().max(4000).nullish(),
  website: z.string().max(200).nullish(),
});
export type SiteContactInput = z.infer<typeof siteContactInput>;

/** "Sign in" on the marketing page: the addresses of the companies this email belongs to, sent by email. */
export const findCompanyInput = z.object({ email: requiredEmail });

/** A page view, reported by the web app's server (no cookies). */
export const siteVisitInput = z.object({
  path: z.string().max(200),
  userAgent: z.string().max(500).nullish(),
  origin: leadOrigin,
});
