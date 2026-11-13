import { redirect } from "next/navigation";
import { orderPaymentTarget } from "@/lib/old-addresses";

/** A request was a page of its own: it is a row of the order's payment plan now. Old links still work. */
export default async function PaymentRequestMoved({ params }: { params: Promise<{ order: string; ref: string }> }) {
  const { order } = await params;
  redirect(orderPaymentTarget(encodeURIComponent(order)));
}
