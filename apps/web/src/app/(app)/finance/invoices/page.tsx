import { redirect } from "next/navigation";
import { dueTarget } from "@/lib/old-addresses";

/** Invoices was a page of its own: what customers owe is on "To receive and to pay" now (money, simple). */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(dueTarget("customers", await searchParams));
}
