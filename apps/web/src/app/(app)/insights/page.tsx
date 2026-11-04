import { redirect } from "next/navigation";
import { insightsTarget } from "@/lib/old-addresses";

/**
 * Insights' sections are pages of the sidebar now (Reports; Profit & loss and Leaks under
 * Finance): /insights?section=…&view=… and the older ?tab= links open the page that has it.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(insightsTarget(await searchParams));
}
