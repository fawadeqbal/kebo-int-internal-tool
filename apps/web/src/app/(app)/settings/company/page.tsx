import { GroupPage } from "../section";

export const metadata = { title: "Company settings" };

/** System & admin › Company settings. */
export default function Page() {
  return <GroupPage href="/settings/company" group="company" />;
}
