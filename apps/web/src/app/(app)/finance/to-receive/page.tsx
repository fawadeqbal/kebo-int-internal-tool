import { redirect } from "next/navigation";
import { dueTarget } from "@/lib/old-addresses";

/** To receive was a page of its own: it is the customers' side of "To receive and to pay" now (money, simple). */
export default async function ToReceivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(dueTarget("customers", await searchParams));
}
