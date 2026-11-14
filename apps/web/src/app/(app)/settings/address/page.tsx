import { notFound } from "next/navigation";
import { SettingsPage } from "../section";
import { AddressCard } from "./card";

export const metadata = { title: "Company address · Settings" };

/** Settings › Company address: the company's own web address (only once companies have addresses). */
export default function Page() {
  if (!process.env.BASE_DOMAIN) notFound();
  return (
    <SettingsPage href="/settings/address" adminOnly description="Where your team signs in: your company's own address.">
      <AddressCard />
    </SettingsPage>
  );
}
