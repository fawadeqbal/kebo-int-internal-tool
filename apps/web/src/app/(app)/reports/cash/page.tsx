import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Cash · Reports" };

/** Reports › Cash: what came in and went out by month, and each account at the start and the end of the period. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="cash" searchParams={searchParams} />;
}
