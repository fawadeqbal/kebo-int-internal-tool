import { redirect } from "next/navigation";
import { companyCostsTarget } from "@/lib/old-addresses";

/** Expenses was one list of everything: an order's costs are on the order now, the rest is Company costs (money, simple). */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(companyCostsTarget(await searchParams));
}
