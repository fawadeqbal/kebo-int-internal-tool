"use client";

import { useLinkStatus } from "next/link";

/**
 * Inside a link: a small turning ring while the page it opens is on its way, so a tap on a tab or a page
 * number shows at once that it was taken (the page itself keeps showing until the new one is ready).
 */
export function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={pending ? "size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70" : "hidden"} />;
}
