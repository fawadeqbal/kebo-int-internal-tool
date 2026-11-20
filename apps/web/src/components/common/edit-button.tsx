"use client";

import { type ComponentProps, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button, cn } from "@kebo/ui";

/**
 * "✎ Edit": the one way a card, a table of lines or a block says it can be changed — the quiet ✎ Edit in the box's
 * head (the record box's, the same everywhere: ghost, small, in the link colour). Read-only (no permission): render
 * nothing, so the button itself tells what is editable. Its words say what opens ("Edit", "Edit items", "Edit plan").
 */
export function EditButton({ label = "Edit", className, ...props }: Omit<ComponentProps<"button">, "children"> & { label?: ReactNode }) {
  return (
    <Button size="xs" variant="ghost" className={cn("text-primary hover:text-primary", className)} {...props}>
      <Pencil aria-hidden /> {label}
    </Button>
  );
}
