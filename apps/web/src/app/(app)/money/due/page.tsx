import { redirect } from "next/navigation";
import { buildHref, PageHeader, Stack } from "@kebo/ui";
import { companyToday } from "@/lib/format";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { CustomersOwe, PAYABLES, type Search } from "./lists";

export const metadata = { title: "Receivables" };

/**
 * Finance › Receivables (design "money, simple", board MRecv): what customers owe us, one row per order. An order
 * opens to its parts with Send request and Record payment. Payables is a page of its own (22 Nov 2026).
 */
export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const sp = await searchParams;
  // The supplier side's old address (?side=suppliers) goes to Payables.
  if (sp.side === "suppliers") redirect(buildHref(PAYABLES, {}, { show: sp.show, q: sp.q, page: sp.page, pay: sp.pay }));
  return (
    <Stack>
      <PageHeader kind="list" crumbs={crumbsFor("/money/due")} title={labelFor("/money/due")} />
      <CustomersOwe sp={sp} me={me} today={companyToday()} />
    </Stack>
  );
}
