import { SettingsPage } from "../section";
import { WebsiteFormCard } from "./card";

export const metadata = { title: "Website form · Settings" };

/** Settings › Website form: inquiries sent from the company's own website. */
export default function Page() {
  return (
    <SettingsPage href="/settings/website-form" adminOnly description="Inquiries from your own website's form come in as new inquiries.">
      <WebsiteFormCard />
    </SettingsPage>
  );
}
