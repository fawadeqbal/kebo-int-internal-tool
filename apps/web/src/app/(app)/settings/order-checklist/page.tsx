import { redirect } from "next/navigation";

/** The order checklist is gone (an order's stages read its own data): its old address opens Settings. */
export default function OrderChecklistGone() {
  redirect("/settings/company");
}
