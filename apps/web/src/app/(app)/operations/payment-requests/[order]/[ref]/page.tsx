import { redirect } from "next/navigation";

/** A request's page moved under Payments: old links still work. */
export default async function PaymentRequestMoved({ params }: { params: Promise<{ order: string; ref: string }> }) {
  const { order, ref } = await params;
  redirect(`/payments/requests/${encodeURIComponent(order)}/${encodeURIComponent(ref)}`);
}
