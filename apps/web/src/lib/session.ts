import { SERVER_TZ, setCompanyTime } from "@/lib/format";
import type { DateFormat, TimeFormat, TimeStyle } from "@kebo/utils";
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission, type PlanFeature, type Role } from "@kebo/shared";
import { api, ApiError } from "./api";
import { dataOf, optional, part } from "./part";
import { PAGE_HEADER } from "./page-header";

export interface Me {
  id: string;
  name: string;
  email: string;
  /** The role's key, and its name as it is now. */
  role: Role;
  roleName: string;
  permissions: Permission[];
  /** Their role needs two-step sign-in and they have not set it up: only the setup page is open. */
  twoStepSetupRequired: boolean;
  /** A platform admin working in this company. */
  viaPlatform?: boolean;
  company?: { slug: string; name: string; kind: "client" | "demo" | "trial"; status: "active" | "read_only" | "off" | "deleted"; statusReason: string | null; endsAt: string | null } | null;
  /** Their own language (en, zh, ur). */
  language?: string;
  /** The company's time zone and how it writes dates and times (Company settings › Time and dates). */
  timeZone?: string;
  dateFormat?: DateFormat;
  timeFormat?: TimeFormat;
}

/** The company's time, as the session says it (the server's zone until it is known). */
export const timeStyleOf = (me: Pick<Me, "timeZone" | "dateFormat" | "timeFormat">): TimeStyle => ({
  zone: me.timeZone || SERVER_TZ,
  date: me.dateFormat ?? "d_mmm_yyyy",
  time: me.timeFormat ?? "24h",
});

/** The company the person is signed in to: its plan, usage, features and the notices to show. */
export interface CompanyView {
  slug: string;
  name: string;
  kind: "client" | "demo" | "trial";
  status: "active" | "read_only" | "off" | "deleted";
  statusReason: string | null;
  endsAt: string | null;
  renewsOn: string | null;
  plan: { name: string; maxUsers: number | null; maxStorageMb: number | null; features: string[]; priceMinor: number; currency: string; period: string } | null;
  features: string[];
  usage: { users: number; storageMb: number };
  notices: { tone: "info" | "warn" | "danger"; text: string }[];
}

/**
 * The signed-in person's company (once per request). Not read (logged): null, and the frame offers every module
 * (the API still checks each) without the company's notices.
 */
export const getCompany = cache(async (): Promise<CompanyView | null> => dataOf(await part("the company", () => api.get<CompanyView>("/company"))));

/** Whether the company's plan includes a feature (no answer: assume yes, the API still checks). */
export async function hasFeature(feature: PlanFeature) {
  const c = await getCompany();
  return !c || c.features.includes(feature);
}

export const TWO_STEP_SETUP_PATH = "/login/set-up-two-step";

/**
 * The sign-in page, coming back afterwards to the page that was asked for (review 24 Nov, X-30: a link opened
 * while signed out landed on the dashboard). Home needs no return.
 */
export async function signInHref() {
  const page = (await headers()).get(PAGE_HEADER) ?? "";
  return page.startsWith("/") && !page.startsWith("//") && !/^\/(dashboard)?(\?|$)/.test(page) && !page.startsWith("/login")
    ? `/login?next=${encodeURIComponent(page)}`
    : "/login";
}

/** The signed-in person (once per request), or off to the sign-in page. */
export const requireUser = cache(async (): Promise<Me> => {
  try {
    const me = await api.get<Me>("/auth/me");
    if (me.twoStepSetupRequired) redirect(TWO_STEP_SETUP_PATH);
    // Every date and time on this request's pages is the company's.
    setCompanyTime(timeStyleOf(me));
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(await signInHref());
    throw e;
  }
});

export async function requirePermission(permission: Permission) {
  const me = await requireUser();
  if (!can(me, permission)) redirect("/forbidden");
  return me;
}

/** Load something, turning a 404 into Next's not-found page and 403 into the forbidden page. */
export async function load<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const { notFound } = await import("next/navigation");
      notFound();
    }
    if (e instanceof ApiError && e.status === 403) redirect("/forbidden");
    if (e instanceof ApiError && e.status === 401) redirect(await signInHref());
    throw e;
  }
}

/**
 * The company's brand on its documents (Settings → Company: logo, title, the line under it); null when this person
 * may not read it. Any other failure is the document's error page (Try again): a paper for a customer is not made
 * without its logo, mark and line (its name would still come from the paper's own copy of the company).
 */
export const docBrand = cache(async (): Promise<{ logo: string | null; mark: string; tagline: string | null } | null> => {
  const b = await optional(() => api.get<{ logo: string | null; mark: string; tagline: string | null }>("/company/brand"));
  return b ? { logo: b.logo, mark: b.mark, tagline: b.tagline } : null;
});

/** The company's time zone, read from the session: for server actions, which run outside a page's render. */
export async function companyZone(): Promise<string> {
  return timeStyleOf(await requireUser()).zone;
}
