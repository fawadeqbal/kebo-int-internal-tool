import { SettingsPage } from "../section";
import { PapersCard } from "./card";
import { getSettings } from "@/lib/loaders";

export const metadata = { title: "Document templates" };

/** System & admin › Document templates: the papers the company uses on its orders. */
export default async function Page() {
  return (
    <SettingsPage href="/settings/papers">
      <PapersCard value={(await getSettings()).papers} />
    </SettingsPage>
  );
}
