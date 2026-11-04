import { ReportPage, type ReportSearch } from "@/components/insights/report-page";

export const metadata = { title: "Targets" };

/** Reports › People & targets › Set targets: the company's and each person's monthly sales targets. */
export default function Page({ searchParams }: { searchParams: Promise<ReportSearch> }) {
  return <ReportPage kind="targets" searchParams={searchParams} />;
}
