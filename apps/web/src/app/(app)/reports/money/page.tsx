import { redirect } from "next/navigation";
import { buildHref } from "@kebo/ui";

/** "Where we lose money" moved to Insights → Profit. */
export default async function MoneyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(buildHref("/insights", {}, { tab: "profit", sub: sp.view ?? "attention", from: sp.from, to: sp.to }));
}
