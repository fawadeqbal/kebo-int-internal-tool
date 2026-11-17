"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { cn } from "@kebo/ui";

/** The inquiry's pages that have a top of their own: one quotation, one factory offer. */
const OWN_PAGES = new Set(["quotations", "offers"]);

/** True on a quotation's or an offer's own page (…/quotations/<id>, …/offers/<id>). */
function ownPage(segments: string[]) {
  return segments.length > 1 && OWN_PAGES.has(segments[0] ?? "");
}

/**
 * The inquiry's top (title, tabs, "Do next"), left out on a quotation's or an offer's own page (design 17 Nov:
 * each on its own page, with its own top).
 */
export function DealChrome({ children }: { children: ReactNode }) {
  return ownPage(useSelectedLayoutSegments()) ? null : <>{children}</>;
}

/** The page under the inquiry's top; an own page starts at the top instead. */
export function DealBody({ children }: { children: ReactNode }) {
  return <div className={cn(!ownPage(useSelectedLayoutSegments()) && "mt-4")}>{children}</div>;
}
