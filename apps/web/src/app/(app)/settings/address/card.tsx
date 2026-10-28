import { Alert, Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { AddressForm } from "./form";
import type { AddressView } from "./types";

/** The company's own address (<short name>.<BASE_DOMAIN>), and changing it. */
export async function AddressCard() {
  const view = await api.get<AddressView>("/company/address");
  const host = view.url.replace(/^https:\/\//, "");
  const wait = view.nextChangeOn
    ? new Date(view.nextChangeOn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  return (
    <Card>
      <CardHeader title="Company address" description="Where your team signs in and works. Links in emails go here too." />
      <CardBody className="flex flex-col gap-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Now</p>
          <a href={view.url} className="mt-1 inline-block font-mono text-base font-medium text-primary hover:underline">
            {host}
          </a>
        </div>
        {!view.canChange ? (
          <Alert tone="info">Only a Super Admin can change the company&apos;s address.</Alert>
        ) : wait ? (
          <Alert tone="info">The address was changed recently. It can change again on {wait}, or ask us to change it sooner.</Alert>
        ) : null}
        <AddressForm view={view} disabled={!view.canChange || !!wait} />
      </CardBody>
    </Card>
  );
}
