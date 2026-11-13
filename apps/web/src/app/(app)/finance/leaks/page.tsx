import { redirect } from "next/navigation";
import { profitTarget } from "@/lib/old-addresses";

/** Profit & loss, Planned vs spent and "Where we lose money" are one tab now: Reports › Profit (old links keep working). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(profitTarget(await searchParams));
}
