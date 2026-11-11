import type { Settings } from "@kebo/shared";
import { api } from "@/lib/api";
import { SettingsPage } from "../section";
import { PapersCard } from "./card";

export const metadata = { title: "Document templates" };

/** System & admin › Document templates: the papers the company uses on its orders. */
export default async function Page() {
  return (
    <SettingsPage href="/settings/papers" description="The papers your company makes for its orders. Switched-off papers leave the Papers lists and the checklists.">
      <PapersCard value={(await api.get<Settings>("/settings")).papers} />
    </SettingsPage>
  );
}
