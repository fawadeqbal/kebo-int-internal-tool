import "server-only";
import type { DocLang } from "./zh";
import { api, ApiError } from "@/lib/api";
import type { CompanySnapshot, CustomerNow, CustomerSnapshot } from "@/lib/types-orders";
import { localPath } from "@/lib/paths";
import { getSettings } from "@/lib/loaders";

/**
 * Sent and issued documents carry the letterhead and customer as they were
 * then (snapshots). Drafts have none yet: they print with today's. The
 * customer has the shape of the order's buyer (BuyerSnapshot: name, country,
 * address, tax and registration numbers, contact); order papers get theirs
 * from the API (the buyer as on the order), so only quotations use this.
 */
export async function companyOr(snapshot: CompanySnapshot | null): Promise<CompanySnapshot> {
  if (snapshot?.name) return snapshot;
  return (await getSettings()).company;
}

export async function customerOr(
  snapshot: CustomerSnapshot | null,
  who: () => Promise<{ customerId: string; contactId?: string | null }>,
): Promise<CustomerSnapshot> {
  if (snapshot?.name) return snapshot;
  const { customerId, contactId } = await who();
  const c = await api.get<CustomerNow>(`/customers/${customerId}`);
  const contact = c.contacts.find((x) => x.id === contactId) ?? c.contacts.find((x) => x.isPrimary) ?? c.contacts[0] ?? null;
  return {
    name: c.name,
    country: c.country,
    address: c.address,
    taxNo: c.taxNo,
    regNo: c.regNo ?? null,
    contact: contact && { name: contact.name, email: contact.email, phone: contact.phone ?? contact.whatsapp },
  };
}

/** Where a print page's Back goes: a same-site path from ?back=, else the given default. */
export function backTo(back: string | undefined, fallback: string) {
  return localPath(back, fallback);
}

/** Optional reads (e.g. factory details for people who may not see factories) fall back to nothing. */
export async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/**
 * The same paper in English and in English with Chinese (?lang=zh), for the toolbar's language switch: the
 * page's own query kept (the copy, the version, where Back goes).
 */
export function langLinks(path: string, sp: Record<string, string | string[] | undefined>, current: DocLang) {
  const href = (lang: DocLang) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "lang" && typeof v === "string" && v) q.set(k, v);
    if (lang === "zh") q.set("lang", "zh");
    return `${path}${q.size ? `?${q}` : ""}`;
  };
  return { current, en: href("en"), zh: href("zh") };
}

/** A PDF link in the paper's language (?lang=zh added to its query). */
export const pdfIn = (href: string, lang: DocLang) => (lang === "zh" ? `${href}${href.includes("?") ? "&" : "?"}lang=zh` : href);
