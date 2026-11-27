import { redirect } from "next/navigation";

/** Suppliers are edited in the side panel on their page; old links and bookmarks land there. */
export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/suppliers/${encodeURIComponent(id)}?panel=edit-factory&id=${encodeURIComponent(id)}`);
}
