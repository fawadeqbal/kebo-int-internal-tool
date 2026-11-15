import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Spending" };

/** Reports › Spending: who spends, on what, and what winning and losing cost us. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="spending" searchParams={searchParams} />;
}
