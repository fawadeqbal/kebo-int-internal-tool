import { redirect } from "next/navigation";
import { reportsPrintTarget } from "@/lib/old-addresses";

/** The Print tab is gone: every report has View / Print and PDF in its header (old links open the overview). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(reportsPrintTarget(await searchParams));
}
