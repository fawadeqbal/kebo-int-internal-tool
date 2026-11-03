import { redirect } from "next/navigation";

/** Customers are edited in the side panel on their page; old links and bookmarks land there. */
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/customers/${encodeURIComponent(id)}?panel=edit-customer&id=${encodeURIComponent(id)}`);
}
