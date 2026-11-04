import { GroupPage } from "../section";

export const metadata = { title: "Emails · Settings" };

/** Settings › Emails. */
export default function Page() {
  return <GroupPage href="/settings/emails" group="notifications" />;
}
