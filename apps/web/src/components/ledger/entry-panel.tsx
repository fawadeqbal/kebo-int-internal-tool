"use client";

import type { ReactNode } from "react";
import { PanelBody, UrlWindow } from "@/components/common/panel";

/**
 * One ledger entry in the side panel (?panel=entry&id=<posting>): opened by a click on a row, closed by ✕, Esc or
 * Back. The body (both sides, what it settles, the document) is drawn on the server.
 */
export function EntryPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <UrlWindow name="entry" title={title} description={description}>
      <PanelBody className="gap-4">{children}</PanelBody>
    </UrlWindow>
  );
}
