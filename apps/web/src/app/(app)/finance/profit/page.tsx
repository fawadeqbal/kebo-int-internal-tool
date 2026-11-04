import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Profit & loss" };

/** Finance › Profit & loss: the money figures for a period, then the profit and loss month by month. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="profit" searchParams={searchParams} />;
}
