import { GroupPage } from "../section";

export const metadata = { title: "Reminders · Settings" };

/** Settings › Reminders. */
export default function Page() {
  return <GroupPage href="/settings/reminders" group="reminders" />;
}
