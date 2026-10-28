import { redirect } from "next/navigation";

/** Files and notes now sit on the deal's Overview; old links land there. */
export default async function DealFiles({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/deals/${id}`);
}
