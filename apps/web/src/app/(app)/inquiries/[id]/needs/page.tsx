import { redirect } from "next/navigation";

/** Needs is no longer a tab: the items the customer asked for are a card on the Overview. Old links land there. */
export default async function DealNeeds({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/inquiries/${id}#items`);
}
