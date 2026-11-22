import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { PageHeader, Stack } from "@kebo/ui";
import { companyToday } from "@/lib/format";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { WeOwe, type Search } from "../due/lists";

export const metadata = { title: "Payables" };

/**
 * Finance › Payables (design "money, simple", board MPayb): what we owe suppliers, on bills and to our own people,
 * one row per part or bill, each paid in a window. Its own page since 22 Nov 2026 (it was a side of Receivables).
 */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  if (!can(me, "sourcing.manage")) redirect("/money/due");
  const sp = await searchParams;
  return (
    <Stack>
      <PageHeader kind="list" crumbs={crumbsFor("/money/payables")} title={labelFor("/money/payables")} />
      <WeOwe sp={sp} me={me} today={companyToday()} />
    </Stack>
  );
}
