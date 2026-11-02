import { redirect } from "next/navigation";

/** The old money tab is now on the payment step. */
export default async function OldMoney({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/payment`);
}
