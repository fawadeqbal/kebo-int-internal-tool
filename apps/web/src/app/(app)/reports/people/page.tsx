import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "People & targets" };

/** Reports › People & targets: who sells, how fast, and against their targets. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="people" searchParams={searchParams} />;
}
