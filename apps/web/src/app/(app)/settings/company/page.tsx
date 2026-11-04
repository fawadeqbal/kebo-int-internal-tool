import { GroupPage } from "../section";

export const metadata = { title: "Company · Settings" };

/** Settings › Company. */
export default function Page() {
  return <GroupPage href="/settings/company" group="company" />;
}
