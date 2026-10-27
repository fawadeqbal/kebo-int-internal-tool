import { redirect } from "next/navigation";
import { buildHref } from "@kebo/ui";

/** Reports moved to Insights → Sales (old links and bookmarks keep working). */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(buildHref("/insights", {}, { tab: "sales", from: sp.from, to: sp.to }));
}
