import { COMPANY_KIND_LABEL, PLAN_FEATURE_KEYS } from "@kebo/shared";
import { daysBetween, type ISODate } from "@kebo/utils";
import type { CompanyDetail } from "@/lib/types-platform";
import { plural } from "@/lib/format";

/**
 * The company page's sections (design system: record frame with a visible
 * section list, ?section=…; a chip row on a phone). Overview is the page
 * without a section.
 */
export const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "people", label: "People" },
  { key: "plan", label: "Plan & modules" },
  { key: "billing", label: "Billing" },
  { key: "details", label: "Details" },
  { key: "history", label: "History" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** The section a ?section= asks for (anything else: Overview). */
export const sectionOf = (v: string | string[] | undefined): SectionKey =>
  SECTIONS.find((s) => s.key === (Array.isArray(v) ? v[0] : v))?.key ?? "overview";

/** The link to a section of this company's page (Overview: the page itself). */
export const sectionHref = (id: string, key: SectionKey, extra?: Record<string, string>) => {
  const q = new URLSearchParams(key === "overview" ? {} : { section: key });
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
  const s = q.toString();
  return `/platform/companies/${id}${s ? `?${s}` : ""}`;
};

export type Meaning = "neutral" | "info" | "ok" | "warn" | "bad";

/** One word for where the company stands (the header's badge): Active, Demo, Trial, Overdue, Read-only, Off, Deleted. */
export function headline(
  c: Pick<CompanyDetail, "status" | "kind" | "billing" | "endsAt">,
  now = new Date(),
): { label: string; meaning: Meaning } {
  if (c.status === "deleted") return { label: "Deleted", meaning: "neutral" };
  if (c.status === "off") return { label: "Off", meaning: "bad" };
  if (c.status === "read_only") return { label: "Read-only", meaning: "warn" };
  if (c.kind !== "client") {
    const ended = c.endsAt && new Date(c.endsAt) <= now;
    return { label: `${COMPANY_KIND_LABEL[c.kind]}${ended ? " ended" : ""}`, meaning: ended ? "warn" : "info" };
  }
  if (c.billing === "overdue") return { label: "Overdue", meaning: "bad" };
  return { label: "Active", meaning: "ok" };
}

/** Files in MB as people say them: "640 MB", "1.2 GB". */
export function storage(mb: number): string {
  if (mb < 1024) return `${Math.round(mb * 10) / 10} MB`;
  return `${Math.round((mb / 1024) * 10) / 10} GB`;
}

/** Days from today to a date (negative: past). */
export const daysTo = (today: ISODate, d: string | null | undefined) => (d ? daysBetween(today, d.slice(0, 10) as ISODate) : null);

/** A calendar day without the year: "01 Nov". */
export const dayMonth = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

/** "in 3 days", "today", "3 days ago". */
export const inDays = (n: number) => (n === 0 ? "today" : n > 0 ? `in ${plural(n, "day")}` : `${plural(-n, "day")} ago`);

/** How far into what was paid for the company is (0–100), from the last payment's date to the paid-until date. */
export function paidShare(c: Pick<CompanyDetail, "renewsOn" | "payments">, today: ISODate): number | null {
  if (!c.renewsOn) return null;
  const from = c.payments.find((p) => p.paidUntil === c.renewsOn)?.paidOn ?? c.payments[0]?.paidOn;
  const total = from ? daysBetween(from as ISODate, c.renewsOn as ISODate) : 30;
  const left = daysBetween(today, c.renewsOn as ISODate);
  if (total <= 0) return left < 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)));
}

/** Paid until, in words and meaning, for Billing and the tiles. */
export function paidState(
  c: Pick<CompanyDetail, "kind" | "renewsOn" | "status">,
  today: ISODate,
): { label: string; meaning: Meaning; sub: string } | null {
  if (c.kind !== "client") return null;
  const d = daysTo(today, c.renewsOn);
  if (d === null) return { label: "No date", meaning: "neutral", sub: "no paid-until date yet" };
  if (d < 0) return { label: "Overdue", meaning: "bad", sub: `overdue by ${plural(-d, "day")}` };
  if (d <= 7) return { label: "Due soon", meaning: "warn", sub: `renews ${inDays(d)}` };
  return { label: "Paid", meaning: "ok", sub: `renews ${inDays(d)}` };
}

export interface AttentionItem {
  key: string;
  meaning: Meaning;
  title: string;
  sub?: string;
  /** Where it is dealt with: a section, or a side panel. */
  href: string;
  link: string;
}

const NEAR = 0.8;

/** What needs the platform admin: status, renewal, demo ending, two-step off, near a limit. */
export function attention(c: CompanyDetail, today: ISODate, now = new Date()): AttentionItem[] {
  const out: AttentionItem[] = [];
  const at = (key: SectionKey, extra?: Record<string, string>) => sectionHref(c.id, key, extra);
  if (c.status === "deleted") return out;
  if (c.status === "off" || c.status === "read_only")
    out.push({
      key: "status",
      meaning: c.status === "off" ? "bad" : "warn",
      title: c.status === "off" ? "Switched off: nobody can sign in" : "Read-only: people can look, not change",
      sub: [c.statusReason, c.statusManual ? "set by hand" : "by the automatic rules"].filter(Boolean).join(" · "),
      href: at("overview", { panel: "status", id: "active" }),
      link: "Switch on",
    });
  if (c.kind === "client") {
    const d = daysTo(today, c.renewsOn);
    const price =
      c.plan && c.plan.priceMinor > 0 ? `${c.plan.currency} ${(c.plan.priceMinor / 100).toLocaleString("en-US")} a ${c.plan.period}` : null;
    const last = c.payments[0] ? `last paid ${dayMonth(c.payments[0].paidOn)}` : "no payment recorded";
    if (d === null)
      out.push({
        key: "renewal",
        meaning: "info",
        title: "No paid-until date",
        sub: "record a payment to set it",
        href: at("billing"),
        link: "Billing",
      });
    else if (d < 0)
      out.push({
        key: "renewal",
        meaning: "bad",
        title: `Payment overdue by ${plural(-d, "day")}`,
        sub: [price, last].filter(Boolean).join(" · "),
        href: at("billing"),
        link: "Billing",
      });
    else if (d <= 30)
      out.push({
        key: "renewal",
        meaning: "warn",
        title: `Renewal ${inDays(d)}`,
        sub: [price, last].filter(Boolean).join(" · "),
        href: at("billing"),
        link: "Billing",
      });
  } else if (c.endsAt) {
    const ms = new Date(c.endsAt).getTime() - now.getTime();
    const what = COMPANY_KIND_LABEL[c.kind];
    if (ms <= 0)
      out.push({
        key: "ends",
        meaning: "warn",
        title: `The ${what.toLowerCase()} has ended`,
        sub: "extend it or make it a client",
        href: at("plan"),
        link: "Plan",
      });
    else if (ms <= 3 * 86_400_000) {
      const hours = Math.round(ms / 3_600_000);
      out.push({
        key: "ends",
        meaning: "warn",
        title: `${what} ends in ${hours < 48 ? plural(hours, "hour") : plural(Math.round(hours / 24), "day")}`,
        sub: "extend it or make it a client",
        href: at("plan"),
        link: "Plan",
      });
    }
  }
  const off = c.activity?.twoStepOff ?? 0;
  if (off > 0)
    out.push({
      key: "two-step",
      meaning: "warn",
      title: `Two-step sign-in is off for ${plural(off, "person", "people")}`,
      sub: "they sign in with a password only",
      href: at("people"),
      link: "People",
    });
  const users = c.usage?.users ?? 0;
  const maxUsers = c.plan?.maxUsers;
  if (maxUsers && users >= maxUsers * NEAR)
    out.push({
      key: "people-limit",
      meaning: users >= maxUsers ? "bad" : "info",
      title: users >= maxUsers ? `At the people limit (${maxUsers})` : `Close to the people limit: ${users} of ${maxUsers}`,
      sub: users >= maxUsers ? "they cannot add anyone" : undefined,
      href: at("plan"),
      link: "Plan",
    });
  const mb = c.usage?.storageMb ?? 0;
  const maxMb = c.plan?.maxStorageMb;
  if (maxMb && mb >= maxMb * NEAR)
    out.push({
      key: "files-limit",
      meaning: mb >= maxMb ? "bad" : "info",
      title: mb >= maxMb ? `At the files limit (${storage(maxMb)})` : `Close to the files limit: ${storage(mb)} of ${storage(maxMb)}`,
      sub: mb >= maxMb ? "new files cannot be added" : undefined,
      href: at("plan"),
      link: "Plan",
    });
  return out;
}

/** Modules on, in words: "14 of 16 · Shipping, Delivery and SAT off". */
export function modulesOn(c: Pick<CompanyDetail, "planFeatures" | "featuresOff">, name: (f: string) => string): string {
  const inPlan = c.planFeatures ?? PLAN_FEATURE_KEYS;
  const on = inPlan.filter((f) => !c.featuresOff.includes(f));
  const off = c.featuresOff.filter((f) => inPlan.includes(f));
  return `${on.length} of ${PLAN_FEATURE_KEYS.length}${off.length ? ` · ${off.slice(0, 2).map(name).join(", ")}${off.length > 2 ? ` +${off.length - 2}` : ""} off` : ""}`;
}
