import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Sales funnel" };

/** Reports › Sales funnel: where inquiries go, and why we lose them. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="funnel" searchParams={searchParams} />;
}
