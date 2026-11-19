import { SettingsPage } from "../section";
import { WebsiteFormCard } from "./card";

export const metadata = { title: "Website form · Settings" };

/** Settings › Website form: inquiries sent from the company's own website. */
export default function Page() {
  return (
    <SettingsPage href="/settings/website-form" adminOnly>
      <WebsiteFormCard />
    </SettingsPage>
  );
}
