import { Suspense } from "react";
import { Toast } from "@kebo/ui/client";
import { platformApi } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { PlatformShell } from "@/components/platform/shell";
import type { PlatformCounts } from "@/lib/types-platform";
import { RowClicks } from "@/components/common/row-clicks";
import { dataOf, part } from "@/lib/part";

export const metadata = { title: { template: "%s · Platform", default: "Platform" } };

export default async function PlatformLayout({ children, window: win }: { children: React.ReactNode; window: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  // The menu's counts only: not read (logged), the menu shows without them.
  const counts = dataOf(await part("the menu's counts", () => platformApi.get<PlatformCounts>("/counts"))) ?? {};
  return (
    <>
      <PlatformShell admin={admin} counts={counts}>
        {children}
        {win}
      </PlatformShell>
      <Suspense>
        <Toast />
        <RowClicks />
      </Suspense>
    </>
  );
}
