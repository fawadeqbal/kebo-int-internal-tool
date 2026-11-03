import { redirect } from "next/navigation";

/** New factories are added in the side panel over the list; old links and bookmarks land there. */
export default function NewFactoryPage() {
  redirect("/factories?panel=new-factory");
}
