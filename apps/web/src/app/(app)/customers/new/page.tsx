import { redirect } from "next/navigation";

/** New customers are added in the side panel over the list; old links land there. */
export default function NewCustomerPage() {
  redirect("/customers?panel=new-customer");
}
