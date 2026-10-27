import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import type { SecurityOverview } from "@/lib/types-people";
import { SecurityTabs } from "./tabs";

export const metadata = { title: "Security" };

/** Security (Super Admin): who may do what, two-step sign-in per role, who is signed in, and every sign-in attempt. */
export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("security.manage");
  const o = await api.get<SecurityOverview>("/security/overview");
  return (
    <div>
      <PageHeader title="Security" description="Who may do what, who must use two-step sign-in, where people are signed in, and every sign-in attempt." />
      <SecurityTabs failed={o.failedLastDay} />
      {children}
    </div>
  );
}
