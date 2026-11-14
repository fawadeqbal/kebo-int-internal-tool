import { notFound } from "next/navigation";
import { SettingsPage } from "../section";
import { AddressCard } from "./card";
import { DomainCard, domainView } from "./domain-card";

export const metadata = { title: "Company address · Settings" };

/**
 * Settings › Company address: the company's address under ours (only once companies have addresses), and
 * under it the company's own domain, where this server offers that.
 */
export default async function Page() {
  if (!process.env.BASE_DOMAIN) notFound();
  const domain = await domainView();
  return (
    <SettingsPage href="/settings/address" adminOnly description="Where your team signs in: your company's own address.">
      <AddressCard sendsTo={domain?.enabled && domain.status === "connected" ? domain.domain : null} />
      <DomainCard view={domain} />
    </SettingsPage>
  );
}
