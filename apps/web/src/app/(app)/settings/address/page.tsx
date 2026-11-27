import { notFound } from "next/navigation";
import { SettingsPage } from "../section";
import { AddressCard } from "./card";
import { DomainCard, domainView } from "./domain-card";
import { dataOf } from "@/lib/part";

export const metadata = { title: "Company address · Settings" };

/**
 * Settings › Company address: the company's address under ours (only once companies have addresses), and
 * under it the company's own domain, where this server offers that.
 */
export default async function Page() {
  if (!process.env.BASE_DOMAIN) notFound();
  const domainPart = await domainView();
  const domain = dataOf(domainPart);
  return (
    <SettingsPage href="/settings/address" adminOnly>
      <AddressCard sendsTo={domain?.enabled && domain.status === "connected" ? domain.domain : null} />
      <DomainCard view={domainPart} />
    </SettingsPage>
  );
}
