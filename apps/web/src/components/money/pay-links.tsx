import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { buildHref, ButtonLink } from "@kebo/ui";

/**
 * Money is a figure and a link (architecture review §8): every "Record payment" opens the one form
 * (Treasury › Payments › Record payment) with what is known filled in, and every "View payments"
 * opens Treasury › Payments filtered to the record. `back`: the page to return to.
 */
export function RecordPaymentLink({
  kind,
  order,
  customer,
  factory,
  amount,
  part,
  back,
  label = "Record payment",
  quiet = true,
}: {
  kind: "in" | "out" | "expense" | "transfer";
  order?: string;
  /** Money in from a customer, over several of their orders (one transfer). */
  customer?: string;
  /** Money out: the supplier, the amount and which part of their plan. */
  factory?: string;
  amount?: string;
  part?: "deposit" | "balance";
  back?: string;
  label?: string;
  quiet?: boolean;
}) {
  return (
    <ButtonLink
      href={recordPaymentHref({ kind, order, customer, factory, amount, part, back })}
      size="sm"
      variant={quiet ? "secondary" : "primary"}
      className="w-fit"
    >
      <Plus aria-hidden /> {label}
    </ButtonLink>
  );
}

export const recordPaymentHref = (q: {
  kind: string;
  order?: string;
  customer?: string;
  factory?: string;
  amount?: string;
  part?: string;
  back?: string;
}) => buildHref("/payments/new", {}, q);

export function ViewPaymentsLink({ order, party, label = "View payments" }: { order?: string; party?: string; label?: string }) {
  return (
    <Link
      href={buildHref("/payments", {}, { order, party })}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {label} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}
