import { redirect } from "next/navigation";

/** The old goods tab is now on the production step. */
export default async function OldGoods({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/production`);
}
