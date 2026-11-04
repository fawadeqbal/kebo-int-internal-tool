import { SettingsPage } from "../section";
import { OrderChecklistCard } from "./card";

export const metadata = { title: "Order checklist · Settings" };

/** Settings › Order checklist: what every new order starts with. */
export default function Page() {
  return (
    <SettingsPage href="/settings/order-checklist" description="The list every new order starts with. Orders already made keep theirs.">
      <OrderChecklistCard />
    </SettingsPage>
  );
}
