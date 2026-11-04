import { PrintableReports, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Printable reports" };

/** Reports › Printable reports: the sales report to print or download, and the reports' tables in Excel. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch & { staff?: string }> }) {
  return <PrintableReports searchParams={searchParams} />;
}
