"use client";

import type { ComponentProps } from "react";
import { Select } from "@kebo/ui";

/** A select that sends its form as soon as a choice is made (the "Order" of Record payment): no Continue button. */
export function AutoSelect(props: ComponentProps<typeof Select>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
