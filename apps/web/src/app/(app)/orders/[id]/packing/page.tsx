import { redirect } from "next/navigation";

/** The old packing tab is now on the shipping step. */
export default async function OldPacking({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/shipping`);
}
