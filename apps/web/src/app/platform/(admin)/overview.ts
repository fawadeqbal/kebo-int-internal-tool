import { dateTime } from "@/lib/format";
import type { Dashboard, Money, Overview } from "@/lib/types-platform";

export type Meaning = "neutral" | "info" | "ok" | "warn" | "bad";

/** Amounts in each currency: "USD 5,880" (or "USD 5,880 · EUR 300"); nothing: "USD 0". */
export const moneyText = (m: Money[]) =>
  m.length ? m.map((x) => `${x.currency} ${Math.round(x.amountMinor / 100).toLocaleString("en-US")}`).join(" · ") : "USD 0";

/** This month against last month, in words ("▲ 12% vs October"), by the main currency. */
export function versus(now: Money[], before: Money[], lastMonth: string): string | null {
  const cur = now[0]?.currency ?? before[0]?.currency;
  if (!cur) return null;
  const a = now.find((x) => x.currency === cur)?.amountMinor ?? 0;
  const b = before.find((x) => x.currency === cur)?.amountMinor ?? 0;
  if (!b) return a ? `nothing in ${lastMonth}` : null;
  const pct = Math.round(((a - b) / b) * 100);
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs ${lastMonth}`;
}

export interface Attention {
  key: string;
  meaning: Meaning;
  title: string;
  sub?: string;
  href: string;
  link: string;
}

const list = (names: string[], max = 3) => `${names.slice(0, max).join(", ")}${names.length > max ? ` +${names.length - max}` : ""}`;
export const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What needs the platform admin today: overdue payments, demos ending, the server's warnings, new client inquiries, follow-ups due. */
export function overviewAttention(d: Dashboard, followUps: Overview["followUps"]): Attention[] {
  const out: Attention[] = [];
  if (d.overdue.length)
    out.push({
      key: "overdue",
      meaning: "bad",
      title: `${n(d.overdue.length, "company is", "companies are")} overdue`,
      sub: list(d.overdue.map((c) => `${c.name} ${n(c.days, "day")}`)),
      href: d.overdue.length === 1 ? `/platform/companies/${d.overdue[0]!.id}?section=billing` : "/platform/companies?kind=client",
      link: d.overdue.length === 1 ? "Billing" : "Companies",
    });
  if (d.ending.length)
    out.push({
      key: "ending",
      meaning: "warn",
      title: `${n(d.ending.length, "demo or trial ends", "demos and trials end")} this week`,
      sub: list(d.ending.map((c) => c.name)),
      href: d.ending.length === 1 ? `/platform/companies/${d.ending[0]!.id}?section=plan` : "/platform/companies?kind=demo",
      link: d.ending.length === 1 ? "Plan" : "Companies",
    });
  for (const w of d.serverWarnings.slice(0, 2))
    out.push({
      key: `server-${w.id}`,
      meaning: "warn",
      title: w.title,
      sub: w.detail ?? `since ${dateTime(w.at)}`,
      href: "/platform/settings?section=backups",
      link: "Backups",
    });
  if (d.newLeads)
    out.push({
      key: "leads",
      meaning: "info",
      title: `${n(d.newLeads, "new client inquiry", "new client inquiries")}`,
      sub: d.newLeadsDemoRequests ? `${d.newLeadsDemoRequests} asked for a demo` : undefined,
      href: "/platform/leads?status=new",
      link: "Client inquiries",
    });
  if (followUps.length)
    out.push({
      key: "follow-ups",
      meaning: "info",
      title: `${n(followUps.length, "follow-up")} due`,
      sub: list(followUps.map((l) => l.companyName)),
      href: followUps.length === 1 ? `/platform/leads/${followUps[0]!.id}` : "/platform/leads",
      link: "Client inquiries",
    });
  return out;
}
