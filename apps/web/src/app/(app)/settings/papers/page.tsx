import { SettingsPage } from "../section";
import { PapersCard } from "./card";
import { getSettings } from "@/lib/loaders";

export const metadata = { title: "Document templates" };

/** System & admin › Document templates: the papers the company uses on its orders. */
export default async function Page() {
  return (
    <SettingsPage href="/settings/papers" description="The papers your company makes for its orders. Switched-off papers leave the Papers lists and the checklists.">
      <PapersCard value={(await getSettings()).papers} />
    </SettingsPage>
  );
}
