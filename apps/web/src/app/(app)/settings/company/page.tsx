import { GroupPage } from "../section";

export const metadata = { title: "Company" };

/** System & admin › Company settings. */
export default function Page() {
  return <GroupPage href="/settings/company" group="company" />;
}
