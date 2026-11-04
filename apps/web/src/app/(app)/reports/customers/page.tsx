import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Customers · Reports" };

/** Reports › Customers: who buys, how much, how well they pay. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="customers" searchParams={searchParams} />;
}
