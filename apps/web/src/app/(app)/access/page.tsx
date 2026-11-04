import { redirect } from "next/navigation";

/** People & access has no page of its own: Roles is the first of Security's old pages. */
export default function AccessPage() {
  redirect("/access/roles");
}
