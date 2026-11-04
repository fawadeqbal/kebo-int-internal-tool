import { requirePermission } from "@/lib/session";

/** People & access › Roles, Sessions and Sign-ins (Super Admin): each its own page in the sidebar. */
export default async function AccessLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("security.manage");
  return children;
}
