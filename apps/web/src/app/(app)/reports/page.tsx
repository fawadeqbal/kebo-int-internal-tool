import { redirect } from "next/navigation";
import { buildHref } from "@kebo/ui";
import { ReportPage, type ReportSearch } from "@/components/insights/report-page";
import { reportsOverviewQuery } from "@/lib/old-addresses";

export const metadata = { title: "Reports" };

/** Reports › Overview: how the business is doing. (Old links with only ?from&to open that period.) */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  const old = reportsOverviewQuery(await searchParams);
  if (old) redirect(buildHref("/reports", {}, old));
  return <ReportPage kind="overview" searchParams={searchParams} />;
}
