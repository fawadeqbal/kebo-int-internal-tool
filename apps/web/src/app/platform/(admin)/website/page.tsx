import { redirect } from "next/navigation";

/** The website's words moved into Platform settings (Website): old links land there. */
export default function WebsitePage() {
  redirect("/platform/settings?section=website");
}
