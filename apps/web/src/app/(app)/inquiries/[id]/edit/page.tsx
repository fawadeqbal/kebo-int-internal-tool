import { redirect } from "next/navigation";

/** The old address of the Edit page: the request is edited in its window on the Overview now. */
export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/inquiries/${id}?panel=edit-request`);
}
