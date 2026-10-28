import { Suspense } from "react";
import { Toast } from "@kebo/ui/client";
import { platformApi } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { PlatformShell } from "@/components/platform/shell";

export const metadata = { title: { template: "%s · Platform", default: "Platform" } };

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  const newLeads = (await platformApi.get<unknown[]>("/leads", { status: "new" }).catch(() => [])).length;
  return (
    <>
      <PlatformShell admin={admin} newLeads={newLeads}>
        {children}
      </PlatformShell>
      <Suspense>
        <Toast />
      </Suspense>
    </>
  );
}
