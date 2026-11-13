import { redirect } from "next/navigation";

/**
 * The Money tab is gone: the customer's money is on Payment, the factory's on Factory order and the
 * profit on Costs. Old links land on Payment.
 */
export default async function OrderMoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/payment`);
}
