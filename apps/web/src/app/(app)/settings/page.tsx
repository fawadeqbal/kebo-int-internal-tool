import { redirect } from "next/navigation";
import { settingsTarget } from "@/lib/old-addresses";

/** Settings' sections are pages of the sidebar now: /settings, ?tab=… and ?section=… open the one that has it. */
export default async function SettingsIndex({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(settingsTarget(await searchParams));
}
