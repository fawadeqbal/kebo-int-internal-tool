import { redirect } from "next/navigation";
import { shipmentsTarget } from "@/lib/old-addresses";

/** Shipments is no longer a page of its own: a shipment is on its order (old links keep working). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(shipmentsTarget(await searchParams));
}
