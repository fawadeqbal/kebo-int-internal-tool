import { notFound, redirect } from "next/navigation";
import { UUID } from "@/lib/ids";
import { orderPaymentTarget } from "@/lib/old-addresses";

/** A payment request was a page of its own: it is a row of the order's payment plan now, with its paper and its receipt. */
export default async function PaymentRequestPage({ params }: { params: Promise<{ order: string; ref: string }> }) {
  const { order } = await params;
  if (!UUID.test(order)) notFound();
  redirect(orderPaymentTarget(order));
}
