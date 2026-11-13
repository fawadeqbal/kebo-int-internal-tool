import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Profit · Reports" };

/** Reports › Profit: what was sold, the orders' costs, the company's own costs and what is left; by month and by order. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="profit" searchParams={searchParams} />;
}
