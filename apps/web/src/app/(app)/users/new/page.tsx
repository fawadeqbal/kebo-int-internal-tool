import { redirect } from "next/navigation";

/** People are added in the side panel over Users; old links and bookmarks land there. */
export default function NewUserPage() {
  redirect("/users?panel=new-user");
}
