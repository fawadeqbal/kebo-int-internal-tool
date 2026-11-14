import { z } from "zod";
import { BALANCE_TERMS, CURRENCIES, INCOTERMS } from "../enums";
import { DEFAULT_ORDER_REMINDER_DAYS } from "../workflows/order";
import { isPaperSwitch } from "../workflows/papers";

/**
 * Everything an admin can change, grouped. Each group is stored as one JSON
 * row in `settings` and read through these schemas, so a missing or older
 * value always comes back complete with defaults.
 */
const days = (fallback: number, max = 365) => z.coerce.number().int().min(0).max(max).default(fallback);

/**
 * The company's own details, printed on its documents: everything blank until
 * the company fills it in under Settings → Company (nothing here belongs to any
 * one company).
 */
export const companySettings = z.object({
  name: z.string().trim().min(1).max(200).default("Company"),
  nameLocal: z.string().trim().max(120).default(""),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(254).default(""),
  email2: z.string().trim().max(254).default(""),
  website: z.string().trim().max(120).default(""),
  /** Business license number (unified social credit code). */
  taxNo: z.string().trim().max(60).default(""),
  bankDetails: z.string().trim().max(1000).default(""),
  invoiceFooter: z.string().trim().max(1000).default(""),
  /** Starts every proforma number, e.g. KEB in KEB260916TN07. */
  proformaPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, "Use 1 to 6 letters")
    .default("PI"),
  /** The company's logo at the top of every document (and beside its name in the app): a PNG/JPEG image as a data URL, or empty. */
  logo: z
    .string()
    .trim()
    .max(400_000, "The logo image is too large (keep it under 300 KB)")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Upload the logo as a PNG or JPEG image")
    .default(""),
  /** The title beside the logo on documents (a short name, e.g. "KEBO"); empty: made from the company name. */
  brandMark: z.string().trim().max(24).default(""),
  /** The line under the title (e.g. "INTERNATIONAL TRADE"); empty: none. */
  brandTagline: z.string().trim().max(40).default(""),
  /** The company stamp (seal) printed on proforma invoices: a PNG/JPEG image as a data URL, or empty. */
  stamp: z
    .string()
    .trim()
    .max(400_000, "The stamp image is too large (keep it under 300 KB)")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Upload the stamp as a PNG or JPEG image")
    .default(""),
});

export const salesSettings = z.object({
  /** Reports and totals are in it. */
  currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(CURRENCIES, `Choose ${CURRENCIES.join(", ")}`)).default("USD"),
  /** 1 unit of the main currency buys N of each other currency (only the business's currencies are kept). */
  exchangeRates: z
    .record(z.string().trim(), z.coerce.number().positive("A rate must be more than 0"))
    .default({ CNY: 7.1 })
    .transform((r) =>
      Object.fromEntries(
        Object.entries(r)
          .map(([k, v]) => [k.toUpperCase(), v] as const)
          .filter(([k]) => (CURRENCIES as readonly string[]).includes(k)),
      ),
    ),
  /** When each rate was last changed (YYYY-MM-DD): kept by the API, so old rates can be flagged. */
  rateDates: z.record(z.string(), z.string()).default({}),
  defaultMarginPercent: z.coerce.number().min(0).max(95).default(15),
  quotationValidityDays: days(15),
  defaultDepositPercent: z.coerce.number().min(0).max(100).default(30),
  defaultBalanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  /** The advance we pay a factory when we order (its payment plan starts from it). */
  factoryAdvancePercent: z.coerce.number().min(0).max(100).default(30),
  defaultIncoterm: z.enum(INCOTERMS).default("FOB"),
  /**
   * New factory offers start with these: prices without tax (the tax % is added on top) or with
   * tax included, and the tax %. 0 unless the factories charge tax (e.g. 13% VAT in China).
   */
  factoryTaxIncluded: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  factoryTaxRate: z.coerce.number().min(0, "Cannot be negative").max(100, "Cannot be more than 100%").refine((n) => Math.round(n * 100) === n * 100, "Use at most 2 decimals").default(0),
  /** Payment terms that go on every new quotation (beyond the deposit and balance). */
  defaultPaymentTerms: z.string().trim().max(5000).default(""),
  /** Delivery terms that go on every new quotation (packing, inspection, warranty…). */
  defaultDeliveryTerms: z.string().trim().max(5000).default(""),
  /** The warranty as it goes on sales contracts and SAT certificates. */
  warrantyTerms: z.string().trim().max(1000).default("Warranty: 12 months from the site acceptance test (SAT), parts and service."),
  categories: z.array(z.string().trim().min(1).max(120)).default(["Machinery", "Chemicals", "Building materials", "Auto parts", "Other"]),
});

export const reminderSettings = z.object({
  /** Remind when a deal is still New after this many days. */
  newDays: days(1, 90),
  /** Remind when a deal has been Sourcing this long without a quotation. */
  sourcingDays: days(5, 180),
  /** "Due soon" window for quotation validity and needed-by dates. */
  dueSoonDays: days(3, 60),
  /** Orders: still Confirmed without the deposit after this many days. */
  depositDays: days(DEFAULT_ORDER_REMINDER_DAYS.depositDays, 180),
  /** Orders: In production this long when the factory gave no ready date. */
  productionDays: days(DEFAULT_ORDER_REMINDER_DAYS.productionDays, 365),
  /** Orders: Shipped with money still due this many days after the ship date. */
  balanceDays: days(DEFAULT_ORDER_REMINDER_DAYS.balanceDays, 365),
  /** Tell the managers when an order is this many days late. */
  escalateAfterDays: days(3, 60),
  /** An LC check: days the courier takes the papers to the customer's bank. */
  lcCourierDays: days(4, 60),
});

export const notificationSettings = z.object({
  emails: z.array(z.email()).max(20).default([]),
  newInquiry: z.boolean().default(true),
  dealWonOrLost: z.boolean().default(true),
  paymentReceived: z.boolean().default(true),
  dailySummary: z.boolean().default(true),
});

/**
 * Settings › Papers we use: the papers the company switched off. Empty (the
 * default): every paper is used. Unknown keys are dropped.
 */
export const papersSettings = z.object({
  off: z
    .array(z.string().trim().max(40))
    .max(100)
    .default([])
    .transform((list) => [...new Set(list.filter(isPaperSwitch))]),
});

/* ---------------------------------------------------------------- a company's own outgoing email */

/** How a company sends its email: its Gmail account, any SMTP server, or Resend. */
export const MAIL_PROVIDERS = ["gmail", "smtp", "resend"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const MAIL_PROVIDER_LABEL: Record<MailProvider, string> = { gmail: "Gmail", smtp: "SMTP server", resend: "Resend" };
/** The ports a mail server listens on (nothing else is dialled from the server). */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

/**
 * Admin settings › Email sending. `secret` is the Gmail app password, the SMTP password or the Resend API
 * key: sent only when it is typed (left out: the one already stored is kept), never sent back.
 */
export const mailSettingsInput = z
  .object({
    provider: z.enum(MAIL_PROVIDERS),
    fromName: z.string().trim().max(80).default(""),
    fromEmail: z.string().trim().toLowerCase().email("Type the email address it is sent from").max(200),
    host: z.string().trim().toLowerCase().max(200).optional(),
    port: z.coerce.number().int().optional(),
    username: z.string().trim().max(200).optional(),
    secret: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.provider !== "smtp") return;
    if (!v.host || !/^[a-z0-9.-]+$/.test(v.host)) ctx.addIssue({ code: "custom", path: ["host"], message: "Type the mail server's name, like smtp.example.com" });
    if (!v.port || !(SMTP_PORTS as readonly number[]).includes(v.port)) ctx.addIssue({ code: "custom", path: ["port"], message: `Use port ${SMTP_PORTS.join(", ")}` });
  });
export type MailSettingsInput = z.infer<typeof mailSettingsInput>;

export const mailTestInput = z.object({ to: z.string().trim().toLowerCase().email("Type an email address to send the test to").max(200) });
export type MailTestInput = z.infer<typeof mailTestInput>;

/** What the page is given: everything but the secret. */
export interface MailSettingsView {
  /** null: the company has not set its own; its email goes through the server's, when the server has one. */
  provider: MailProvider | null;
  fromName: string;
  fromEmail: string;
  host: string;
  port: number | null;
  username: string;
  hasSecret: boolean;
  /** The server has its own email set up (used while the company has none). */
  serverDefault: boolean;
  /** Email can be sent right now, one way or the other. */
  enabled: boolean;
}

export const SETTINGS = {
  company: companySettings,
  sales: salesSettings,
  reminders: reminderSettings,
  notifications: notificationSettings,
  papers: papersSettings,
} as const;

export type SettingsKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingsKey]: z.infer<(typeof SETTINGS)[K]> };

/** Read stored values (possibly partial or old) into complete settings. */
export function readSettings(stored: Partial<Record<string, unknown>>): Settings {
  const out = {} as Record<SettingsKey, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
    const parsed = SETTINGS[key].safeParse(stored[key] ?? {});
    out[key] = parsed.success ? parsed.data : SETTINGS[key].parse({});
  }
  return out as Settings;
}

/** Words that do not tell a company apart ("Co., Ltd."), left out of the mark made from its name. */
const GENERIC_WORDS = new Set(["co", "company", "ltd", "limited", "llc", "inc", "corp", "corporation", "pvt", "private", "the", "group", "gmbh", "plc", "and", "&"]);

/** The big word on a company's documents: the one it chose, else its name's first one or two words ("Meray Company" → "MERAY"). */
export function brandMarkOf(mark: string | null | undefined, name: string): string {
  if (mark?.trim()) return mark.trim().toUpperCase();
  const words = name
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(w.toLowerCase()));
  const two = words.slice(0, 2).join(" ");
  return (two.length <= 14 ? two : (words[0] ?? name)).toUpperCase().slice(0, 24);
}
