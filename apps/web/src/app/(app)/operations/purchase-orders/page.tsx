import { redirect } from "next/navigation";
import { purchaseOrdersTarget } from "@/lib/old-addresses";

/** Purchase orders is no longer a page of its own: a purchase order is on its order (old links keep working). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(purchaseOrdersTarget(await searchParams));
}
