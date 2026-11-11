import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Suppliers · Reports" };

/** Reports › Factories: who supplies on time and wins our orders. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="factories" searchParams={searchParams} />;
}
