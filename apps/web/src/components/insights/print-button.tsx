"use client";

import { Printer } from "lucide-react";
import { Button } from "@kebo/ui";

/** Print the page, or save it as a PDF from the print dialog. */
export function PrintButton() {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Printer aria-hidden /> Print / PDF
    </Button>
  );
}
