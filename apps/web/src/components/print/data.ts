import "server-only";
import { api, ApiError } from "@/lib/api";
import type { CompanySnapshot, CustomerNow, CustomerSnapshot } from "@/lib/types-orders";
import { localPath } from "@/lib/paths";

/**
 * Sent and issued documents carry the letterhead and customer as they were
 * then (snapshots). Drafts have none yet: they print with today's.
 */
export async function companyOr(snapshot: CompanySnapshot | null): Promise<CompanySnapshot> {
  if (snapshot?.name) return snapshot;
  return (await api.get<{ company: CompanySnapshot }>("/settings")).company;
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
