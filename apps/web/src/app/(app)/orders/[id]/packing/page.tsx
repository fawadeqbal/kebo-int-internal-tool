import { redirect } from "next/navigation";

/** Packing moved into Shipping (the packing lines and marks): old links land there. */
export default async function OrderPackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/shipping#lines`);
}
