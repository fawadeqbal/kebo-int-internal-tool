import { redirect } from "next/navigation";

/** The Items tab is gone: the order's items are on its Overview, with what came in, was packed and was delivered. */
export default async function OrderItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}`);
}
