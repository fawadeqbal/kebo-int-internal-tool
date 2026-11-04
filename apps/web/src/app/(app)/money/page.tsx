import { redirect } from "next/navigation";
import { moneyTarget } from "@/lib/old-addresses";
import { requirePermission } from "@/lib/session";
import { moneyAccess } from "../finance/sections";

/**
 * Cash & accounts moved into the sidebar (Finance, Purchasing): old links and bookmarks
 * (/money?tab=…) open the page that has it now, with the rest of their filters. Without a
 * tab: the first of them this person may open, as before.
 */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const first = sp.tab ? undefined : await moneyAccess(await requirePermission("sourcing.manage"));
  redirect(moneyTarget(sp, first));
}
