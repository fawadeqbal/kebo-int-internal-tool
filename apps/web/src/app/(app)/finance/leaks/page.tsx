import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Leaks" };

/** Finance › Leaks: where we lose money (deals, orders, customers, spending). */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="leaks" searchParams={searchParams} />;
}
