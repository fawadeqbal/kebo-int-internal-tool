"use client";

import type { ReactNode } from "react";
import { PanelBody, SidePanel, useSidePanel } from "@/components/common/panel";

/**
 * One ledger entry in the side panel (?panel=entry&id=<posting>): opened by a click on a row, closed by ✕, Esc or
 * Back. The body (both sides, what it settles, the document) is drawn on the server.
 */
export function EntryPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const p = useSidePanel("entry");
  if (!p.open) return null;
  return (
    <SidePanel title={title} description={description} onClose={() => p.close()}>
      <PanelBody className="gap-4">{children}</PanelBody>
    </SidePanel>
  );
}
