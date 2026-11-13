import { redirect } from "next/navigation";
import { dueTarget } from "@/lib/old-addresses";

/** To pay was a page of its own: it is the suppliers' side of "To receive and to pay" now (money, simple). */
export default async function ToPayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(dueTarget("suppliers", await searchParams));
}
