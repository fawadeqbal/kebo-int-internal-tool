import { notFound, redirect } from "next/navigation";
import { UUID } from "@/lib/ids";
import { orderPaymentTarget } from "@/lib/old-addresses";

/** An order's invoice was a page of its own: its parts, payments and receipts are on the order's Payment tab now. */
export default async function InvoicePage({ params }: { params: Promise<{ order: string }> }) {
  const { order } = await params;
  if (!UUID.test(order)) notFound();
  redirect(orderPaymentTarget(order));
}
