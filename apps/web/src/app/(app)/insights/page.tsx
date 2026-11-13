import { redirect } from "next/navigation";
import { insightsTarget } from "@/lib/old-addresses";

/**
 * Insights' sections are the tabs of Reports now: /insights?section=…&view=… and the older
 * ?tab= links open the tab that has it.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(insightsTarget(await searchParams));
}
