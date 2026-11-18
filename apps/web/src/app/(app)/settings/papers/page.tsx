import { SettingsPage } from "../section";
import { PapersCard } from "./card";
import { getSettings } from "@/lib/loaders";

export const metadata = { title: "Document templates" };

/** System & admin › Document templates: the papers the company uses on its orders. */
export default async function Page() {
  return (
    <SettingsPage href="/settings/papers" description="The documents your company makes for its orders. Switched-off documents leave the Documents lists and the counts.">
      <PapersCard value={(await getSettings()).papers} />
    </SettingsPage>
  );
}
