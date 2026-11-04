import { Suspense } from "react";
import { Toast } from "@kebo/ui/client";
import { platformApi } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { PlatformShell } from "@/components/platform/shell";
import type { PlatformCounts } from "@/lib/types-platform";

export const metadata = { title: { template: "%s · Platform", default: "Platform" } };

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  const counts = await platformApi.get<PlatformCounts>("/counts").catch(() => ({}));
  return (
    <>
      <PlatformShell admin={admin} counts={counts}>
        {children}
      </PlatformShell>
      <Suspense>
        <Toast />
      </Suspense>
    </>
  );
}
