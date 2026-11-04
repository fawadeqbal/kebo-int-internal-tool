import { redirect } from "next/navigation";
import { reportsMoneyTarget } from "@/lib/old-addresses";

/** "Where we lose money" is Finance › Leaks now (old links and bookmarks keep working). */
export default async function MoneyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(reportsMoneyTarget(await searchParams));
}
