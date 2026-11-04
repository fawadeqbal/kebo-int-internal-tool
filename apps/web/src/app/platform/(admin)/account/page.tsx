import { redirect } from "next/navigation";

/** Your password moved into Platform settings (My account): old links land there, with its panel if one was asked for. */
export default async function PlatformAccountPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { panel } = await searchParams;
  redirect(`/platform/settings?section=account${panel === "password" ? "&panel=password" : ""}`);
}
