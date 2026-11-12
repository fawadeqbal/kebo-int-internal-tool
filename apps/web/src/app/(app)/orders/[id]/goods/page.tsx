import { redirect } from "next/navigation";

/** Goods moved into Production (the lines from the factory): old links land there. */
export default async function OrderGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/production#lines`);
}
