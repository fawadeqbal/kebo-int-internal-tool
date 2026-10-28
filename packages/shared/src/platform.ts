import { z } from "zod";
import { addDays, type ISODate } from "@kebo/utils";
import { isoDate, optionalDate, optionalText, text } from "./schemas/common";
import { CURRENCIES } from "./enums";

/* ============================================================================
 * The platform: companies using the app, plans, client inquiries (leads),
 * demos and trials. Shared by the API (rules) and the web (forms, labels).
 * ========================================================================== */

/** Features a plan can switch on or off. Companies without a plan have them all. */
export const PLAN_FEATURES = {
  insights: "Insights (sales, profit and team reports)",
  cash_book: "Money accounts and cash book",
  excel: "Excel templates, uploads and exports",
} as const;
export type PlanFeature = keyof typeof PLAN_FEATURES;
export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES) as PlanFeature[];

/** How long things last (days). */
export const LIFECYCLE = {
  demoDays: 3,
  trialDays: 14,
  /** After a demo or trial ends: read-only this long, then switched off. */
  readOnlyDays: 7,
  /** Switched off this long after the read-only days, then deleted (demos and trials only). */
  deleteAfterOffDays: 30,
  /** A client past its paid-until date: a warning this long, then read-only… */
  overdueGraceDays: 7,
  /** …and switched off this many days after the paid-until date. Paying companies are never deleted. */
  overdueOffDays: 30,
  /** A deleted company's short name stays taken this long. */
  nameHoldDays: 90,
  /** After a rename, the old short name keeps working this long. */
  renameRedirectDays: 30,
  /** "Ends tomorrow" emails go this long before the end (hours). */
  endingNoticeHours: 24,
} as const;

export const COMPANY_KIND_LABEL = { client: "Client", demo: "Demo", trial: "Trial" } as const;
export const COMPANY_STATUS_LABEL = { active: "Active", read_only: "Read-only", off: "Switched off", deleted: "Deleted" } as const;
export const LEAD_STATUS_LABEL = { new: "New", contacted: "Contacted", demo: "Demo given", client: "Client", lost: "Lost" } as const;
export const LEAD_SOURCE_LABEL = { form: "Demo request", sign_up: "Self sign-up", manual: "Added by hand" } as const;
export const LEAD_STATUSES = ["new", "contacted", "demo", "client", "lost"] as const;
export type LeadStatusKey = (typeof LEAD_STATUSES)[number];

/* ---------------------------------------------------------------- short names (future addresses) */

/** Names nobody can take: they are, or may become, the platform's own addresses. */
export const RESERVED_SLUGS = new Set([
  "admin", "www", "api", "app", "mail", "email", "smtp", "demo", "demos", "support", "help", "status", "docs", "blog",
  "platform", "login", "signin", "signup", "sign-up", "register", "account", "accounts", "billing", "pay", "payments",
  "static", "assets", "cdn", "files", "media", "ftp", "test", "staging", "dev", "internal", "root", "system", "rfq",
  "dashboard", "console", "portal", "auth", "sso", "oauth", "webhook", "webhooks", "ns1", "ns2", "mx", "info", "news",
]);

export const SLUG_RULE = "3 to 30 characters: small letters, numbers and dashes (not at the start or end)";

/** Why a short name cannot be used, or null when it is fine (uniqueness is checked by the API). */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) return `Use ${SLUG_RULE}.`;
  if (slug.includes("--")) return "Two dashes in a row are not allowed.";
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is kept for the platform. Choose another.`;
  return null;
}

/** A short name suggested from a company name ("Acme Trading Co." → "acme-trading"). */
export function suggestSlug(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !["co", "ltd", "llc", "inc", "limited", "company", "corp", "the", "pvt", "gmbh"].includes(w));
  let s = words.join("-").replace(/[^a-z0-9-]/g, "").slice(0, 30).replace(/-+$/, "");
  if (s.length < 3) s = (s + "-co").replace(/^-/, "").padEnd(3, "x");
  return RESERVED_SLUGS.has(s) ? `${s}-co` : s;
}

export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((v, ctx) => {
    const p = slugProblem(v);
    if (p) ctx.addIssue({ code: "custom", message: p });
  });

/* ---------------------------------------------------------------- lifecycle */

export interface LifecycleInput {
  kind: "client" | "demo" | "trial";
  status: "active" | "read_only" | "off" | "deleted";
  statusManual: boolean;
  endsAt: Date | null;
  /** Paid until (clients). */
  renewsOn: ISODate | null;
  endingNoticeFor: Date | null;
}

export type LifecycleStep =
  | { do: "nothing" }
  | { do: "status"; status: "active" | "read_only" | "off"; reason: string | null }
  | { do: "delete"; reason: string }
  | { do: "ending_notice" };

const DAY = 86_400_000;

/**
 * What the automatic rules do to a company now. Demos and trials: read-only when
 * they end, switched off after the read-only days, deleted after the off days.
 * Clients: a warning once past the paid-until date, read-only after the grace
 * days, switched off later; never deleted. A status the platform admin set by
 * hand is left alone.
 */
export function lifecycleStep(c: LifecycleInput, now: Date, today: ISODate): LifecycleStep {
  if (c.status === "deleted") return { do: "nothing" };
  const want = (status: "active" | "read_only" | "off", reason: string | null): LifecycleStep =>
    c.statusManual || c.status === status ? { do: "nothing" } : { do: "status", status, reason };
  if (c.kind === "demo" || c.kind === "trial") {
    const what = c.kind === "demo" ? "demo" : "trial";
    if (!c.endsAt) return want("active", null);
    const ended = now.getTime() - c.endsAt.getTime();
    if (ended < 0) {
      if (-ended <= LIFECYCLE.endingNoticeHours * 3_600_000 && c.endingNoticeFor?.getTime() !== c.endsAt.getTime()) return { do: "ending_notice" };
      return want("active", null);
    }
    if (ended >= (LIFECYCLE.readOnlyDays + LIFECYCLE.deleteAfterOffDays) * DAY) {
      return c.statusManual && c.status === "active" ? { do: "nothing" } : { do: "delete", reason: `The ${what} ended ${LIFECYCLE.readOnlyDays + LIFECYCLE.deleteAfterOffDays} days ago` };
    }
    if (ended >= LIFECYCLE.readOnlyDays * DAY) return want("off", `The ${what} has ended`);
    return want("read_only", `The ${what} has ended`);
  }
  if (!c.renewsOn || today <= c.renewsOn) return want("active", null);
  if (today > addDays(c.renewsOn, LIFECYCLE.overdueOffDays)) return want("off", "Payment overdue");
  if (today > addDays(c.renewsOn, LIFECYCLE.overdueGraceDays)) return want("read_only", "Payment overdue");
  return want("active", null);
}

/** The subscription's state as the platform admin reads it. */
export function billingState(c: { kind: string; status: string; renewsOn: ISODate | null }, today: ISODate): "trial" | "active" | "overdue" | "off" {
  if (c.status === "off" || c.status === "deleted") return "off";
  if (c.kind !== "client") return "trial";
  if (c.renewsOn && today > c.renewsOn) return "overdue";
  return "active";
}
export const BILLING_LABEL = { trial: "Trial", active: "Active", overdue: "Overdue", off: "Off" } as const;

/* ---------------------------------------------------------------- inputs */

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

/** At least 10 characters with a letter and a digit (the same rule as for people in a company). */
export const newPasswordField = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letters and at least one number");

/** The public "Request a demo" form. */
export const demoRequestInput = z.object({
  companyName: text(160, "Enter your company's name"),
  name: text(120, "Enter your name"),
  email,
  phone: optionalText(40),
  country: optionalText(80),
  teamSize: z.enum(["1-5", "6-20", "21-50", "51+"]).nullish().transform((v) => v ?? null),
  message: optionalText(2000),
  /** Bot check token (Cloudflare Turnstile) when it is switched on. */
  botToken: z.string().max(4000).nullish(),
  /** A hidden field people never fill in: bots do. */
  website: z.string().max(200).nullish(),
});
export type DemoRequestInput = z.infer<typeof demoRequestInput>;

export const leadInput = demoRequestInput.omit({ botToken: true, website: true });
export const leadUpdateInput = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  lostReason: optionalText(300),
  followUpOn: optionalDate,
  companyName: text(160).optional(),
  name: text(120).optional(),
  email: email.optional(),
  phone: optionalText(40),
  country: optionalText(80),
});
export const leadNoteInput = z.object({ text: text(4000, "Write the note") });

const optionalInt = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(1_000_000).nullable());

export const planInput = z.object({
  name: text(60, "Name the plan"),
  description: optionalText(300),
  price: z.coerce.number().min(0).max(1_000_000),
  currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(CURRENCIES)).default("USD"),
  period: z.enum(["month", "year"]).default("month"),
  maxUsers: optionalInt,
  maxStorageMb: optionalInt,
  features: z.array(z.enum(PLAN_FEATURE_KEYS as [PlanFeature, ...PlanFeature[]])).default([]),
  isActive: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof planInput>;

/** A company made by the platform admin (a client, or a demo). */
export const companyCreateInput = z.object({
  name: text(120, "Enter the company's name"),
  slug: slugField,
  kind: z.enum(["client", "demo"]).default("client"),
  planId: z.uuid().nullish().transform((v) => v ?? null),
  adminName: text(120, "Enter the tenant admin's name"),
  adminEmail: email,
  /** Demos: fill with sample customers, factories and inquiries. */
  sampleData: z.boolean().default(false),
  /** Demos: how many days (default 3). */
  days: z.coerce.number().int().min(1).max(60).nullish(),
  /** Clients: paid until. */
  renewsOn: optionalDate,
  leadId: z.uuid().nullish().transform((v) => v ?? null),
  notes: optionalText(2000),
});
export type CompanyCreateInput = z.infer<typeof companyCreateInput>;

export const companyUpdateInput = z.object({
  name: text(120).optional(),
  slug: slugField.optional(),
  planId: z.uuid().nullish(),
  renewsOn: optionalDate.optional(),
  contactName: optionalText(120).optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(254).nullish().or(z.literal("")).transform((v) => v || null).optional(),
  notes: optionalText(2000).optional(),
});

export const companyStatusInput = z.object({
  /** active: on; read_only; off. auto: back to the automatic rules. */
  status: z.enum(["active", "read_only", "off", "auto"]),
  reason: optionalText(200),
});

export const extendInput = z.object({ days: z.coerce.number().int().min(1).max(90) });
export const makeRealInput = z.object({ keepData: z.boolean(), planId: z.uuid().nullish().transform((v) => v ?? null), renewsOn: optionalDate });

export const subscriptionPaymentInput = z.object({
  amount: z.coerce.number().positive("Enter the amount").max(10_000_000),
  currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(CURRENCIES)).default("USD"),
  paidOn: isoDate(),
  paidUntil: isoDate("Enter the new paid-until date"),
  note: optionalText(300),
});

/** Self sign-up: a trial company with the person as its tenant admin. */
export const signUpInput = z.object({
  companyName: text(160, "Enter your company's name"),
  slug: slugField,
  name: text(120, "Enter your name"),
  email,
  password: newPasswordField,
  botToken: z.string().max(4000).nullish(),
  website: z.string().max(200).nullish(),
});
export type SignUpInput = z.infer<typeof signUpInput>;

export const setPasswordInput = z.object({
  token: z.string().min(20).max(2000),
  password: newPasswordField,
});
