"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PaymentPlanTable } from "@/components/order-sections/payment-plan";
import { PayFactoryWindow } from "@/components/order-sections/factory-windows";

/**
 * Money › To receive and to pay: a row's button is a link that names the window to open (?do=pay, ?pay=…);
 * the page then draws that row with its window already open. Once the window closes the name leaves the
 * address, so a refresh or the Back button does not open it again.
 */
function useDropParam(name: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete(name);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [router, pathname, params, name]);
}

/** An order's payment plan inside the list (the same table as on the order), with the payment window open when asked. */
export function PlanInList(props: Omit<Parameters<typeof PaymentPlanTable>[0], "onAutoClosed">) {
  const done = useDropParam("do");
  return <PaymentPlanTable {...props} onAutoClosed={done} />;
}

/** "Pay" on a factory's part in the list: the order's own Pay the factory window, opened at once. */
export function PayFactoryInList(props: Omit<Parameters<typeof PayFactoryWindow>[0], "startOpen" | "onClosed">) {
  const done = useDropParam("pay");
  return <PayFactoryWindow {...props} startOpen onClosed={done} />;
}
