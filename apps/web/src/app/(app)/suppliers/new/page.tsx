import { redirect } from "next/navigation";

/** New suppliers are added in the side panel over the list; old links and bookmarks land there. */
export default function NewSupplierPage() {
  redirect("/suppliers?panel=new-factory");
}
