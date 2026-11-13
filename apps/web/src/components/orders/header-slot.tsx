"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/components/common/dialog";

/** Where a tab of the order puts its main button: the order's page header (board: "Record payment", "Set ready date"). */
export const ORDER_HEADER_SLOT = "order-header-slot";

/** Puts its children in the order's header (after the page loads); until then, nothing shows twice. */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const at = mounted ? document.getElementById(ORDER_HEADER_SLOT) : null;
  return at ? createPortal(children, at) : null;
}

