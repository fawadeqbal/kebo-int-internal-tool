import { z } from "zod";
import { BALANCE_TERMS, CURRENCIES, INCOTERMS } from "../enums";
import { DEFAULT_ORDER_REMINDER_DAYS } from "../workflows/order";
import { isPaperSwitch } from "../workflows/papers";
import { DATE_FORMATS, TIME_FORMATS } from "@kebo/utils";

/** A time zone the system knows ("Asia/Karachi"); empty: the server's. */
const isZone = (v: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

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
/** The company's time and date settings: kept on the company row, never in the stored settings. */
export const COMPANY_TIME_KEYS = ["timeZone", "dateFormat", "timeFormat"] as const;

/**
 * The app's colours, chosen for the whole company (Company settings › The app's colours); each set has a light
 * and a dark side, and each person still picks light, dark or auto. Green is the default. The colours themselves
 * are in packages/ui/src/styles/theme.css.
 */
export const COLOUR_SETS = ["green", "graphite", "midnight", "warm", "clay", "teal", "ink", "onyx"] as const;
export type ColourSet = (typeof COLOUR_SETS)[number];
export const COLOUR_SET_LABEL: Record<ColourSet, string> = { green: "Green", graphite: "Graphite", midnight: "Midnight", warm: "Warm", clay: "Clay", teal: "Teal", ink: "Ink", onyx: "Onyx" };

/** Empty, or an email address (review 24 Nov: "bad@" was saved and printed on the customer's proforma). */
const isEmailOrEmpty = (v: string) => v === "" || z.email().safeParse(v).success;
const companyEmail = z.string().trim().max(254).refine(isEmailOrEmpty, "Type an email address, like sales@example.com").default("");

export const companySettings = z.object({
  /**
   * Time and dates: the company's time zone (IANA) and how it writes dates and times. Kept on the company itself
   * (the platform's table, so every request and job knows it at once); shown and changed here with the rest.
   */
  timeZone: z.string().trim().max(60).refine((v) => !v || isZone(v), "Choose a time zone from the list").default(""),
  dateFormat: z.enum(DATE_FORMATS).default("d_mmm_yyyy"),
  timeFormat: z.enum(TIME_FORMATS).default("24h"),
  name: z.string().trim().min(1).max(200).default("Company"),
  nameLocal: z.string().trim().max(120).default(""),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(60).default(""),
  email: companyEmail,
  email2: companyEmail,
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
  /** The app's colours for everyone in the company (not the documents, which keep their own). */
  colours: z.enum(COLOUR_SETS, `Choose ${COLOUR_SETS.join(", ")}`).default("green"),
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
  /** Under this margin an order is thin: adding a cost that takes it there says so first (e2e 24 Nov). */
  marginFloorPercent: z.coerce.number().min(0).max(95).default(5),
  quotationValidityDays: days(15),
  defaultDepositPercent: z.coerce.number().min(0).max(100).default(30),
  defaultBalanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  /** The advance we pay a factory when we order (its payment plan starts from it). */
  factoryAdvancePercent: z.coerce.number().min(0).max(100).default(30),
  defaultIncoterm: z.enum(INCOTERMS).default("FOB"),
  /**
   * Days added to a supplier's lead time when a quotation is made from its offer (canvas "From the supplier offer to
   * the quotation", change 4): our time to book, inspect and truck to the port.
   */
  leadSpareDays: z.coerce.number().int("Whole days").min(0, "Cannot be negative").max(180, "At most 180 days").default(7),
  /**
   * The export VAT refund we get on what we buy from suppliers, as a % of the price before tax (change 6): taken off
   * a supplier's tax in what a quotation costs us. 0: no refund (the tax is cost in full).
   */
  exportVatRefundPercent: z.coerce.number().min(0, "Cannot be negative").max(100, "Cannot be more than 100%").refine((n) => Math.round(n * 100) === n * 100, "Use at most 2 decimals").default(0),
  /**
   * New factory offers start with these: prices without tax (the tax % is added on top) or with
   * tax included, and the tax %. 0 unless the factories charge tax (e.g. 13% VAT in China).
   */
  factoryTaxIncluded: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  factoryTaxRate: z.coerce.number().min(0, "Cannot be negative").max(100, "Cannot be more than 100%").refine((n) => Math.round(n * 100) === n * 100, "Use at most 2 decimals").default(0),
  /** The customer's copy of a quotation shows each line's unit price and amount, not only the total (review 24 Nov, S-21). */
  quoteUnitPrices: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
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

/** Platform settings › Emails: where the platform's own emails go (new client inquiries, sign-ups, server warnings). Empty: every platform admin. */
export const platformInboxInput = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().email("Type email addresses, like you@example.com").max(200))
    .max(10, "At most 10 addresses")
    .transform((list) => [...new Set(list)]),
});
export type PlatformInboxInput = z.infer<typeof platformInboxInput>;

/** Platform settings › Emails: the platform's own sending email (like a company's) and where its emails go. */
export interface PlatformMailView extends MailSettingsView {
  /** Set here; empty: the server's PLATFORM_EMAIL, else every platform admin. */
  inbox: string[];
  /** Where they go now, whichever way. */
  inboxNow: string[];
  inboxFrom: "here" | "server" | "admins";
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
    let raw = stored[key] ?? {};
    // Time and dates come from the company row; a stray copy in the stored JSON is ignored (and never breaks the rest).
    // Colours no longer offered go back to the default, rather than making the whole group unreadable.
    if (key === "company" && raw && typeof raw === "object")
      raw = Object.fromEntries(
        Object.entries(raw).filter(
          ([k, v]) =>
            !(COMPANY_TIME_KEYS as readonly string[]).includes(k) &&
            (k !== "colours" || (COLOUR_SETS as readonly unknown[]).includes(v)) &&
            // An email saved before it was checked, that is not one, is left out (never printed, never breaks the rest).
            ((k !== "email" && k !== "email2") || (typeof v === "string" && isEmailOrEmpty(v.trim()))),
        ),
      );
    const parsed = SETTINGS[key].safeParse(raw);
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
