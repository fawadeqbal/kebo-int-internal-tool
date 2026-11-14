import { ButtonLink, PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { numberHint, RecordPayment, type Search } from "./record";

export const metadata = { title: "Record payment" };

/** Where "Back" goes: a record page of ours, never another site. */
const BACK = /^\/(orders|customers|factories|inquiries)\/[0-9a-f-]{36}(\/[a-z-]+)?$/i;

/**
 * Record payment, opened as its own page (a new tab or a reload). From a button in the app it opens as a
 * window over the page you are on (@window/(.)payments/new).
 */
export default async function RecordPaymentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const back = BACK.test(sp.back ?? "") ? sp.back : undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={[...crumbsFor("/payments").slice(0, 1), { label: "Payments", href: "/payments" }, { label: "Record payment" }]}
        title="Record payment"
        summary={numberHint(sp.kind)}
        primary={
          back ? (
            <ButtonLink href={back} variant="secondary">
              Back
            </ButtonLink>
          ) : undefined
        }
      />
      <RecordPayment sp={sp} />
    </div>
  );
}
