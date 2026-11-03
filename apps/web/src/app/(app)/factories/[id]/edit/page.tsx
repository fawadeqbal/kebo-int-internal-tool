import { redirect } from "next/navigation";

/** Factories are edited in the side panel on their page; old links and bookmarks land there. */
export default async function EditFactoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/factories/${encodeURIComponent(id)}?panel=edit-factory&id=${encodeURIComponent(id)}`);
}
