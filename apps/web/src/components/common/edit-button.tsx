"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Pencil, Plus } from "lucide-react";
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

/**
 * "+ Add": the header button of a card that holds a list you add to (a
 * contact, a payment), beside where ✎ Edit sits on a card of details. Quiet
 * (ghost) so the page's one primary stays the only loud button.
 */
export function AddButton({
  label = "Add",
  size = "sm",
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { label?: ReactNode; size?: "xs" | "sm" }) {
  return (
    <Button size={size} variant="ghost" className={cn(size === "sm" && "", className)} {...props}>
      <Plus aria-hidden /> {label}
    </Button>
  );
}

/** The row a click landed on in a table of lines: its row index ("aria-rowindex"), or its place in the body. */
function rowOf(target: EventTarget | null, box: HTMLElement): number | null {
  const el = target as HTMLElement | null;
  if (!el || el.closest("a,button,input,select,textarea,label,summary,[role=menu],[role=menuitem]")) return null;
  const tr = el.closest("tbody tr");
  if (!tr || !box.contains(tr)) return null;
  const at = tr.getAttribute("aria-rowindex");
  if (at) return Number(at);
  return [...(tr.parentElement?.children ?? [])].indexOf(tr) + 1;
}

/**
 * A read-only table of lines that can be edited: a hovered row is
 * highlighted and shows a pencil at its end, and a click on it opens the
 * table's edit mode on that row. The table itself (LineTable) is not changed:
 * this only wraps it.
 */
export function EditableRows({
  onRow,
  label,
  children,
  className,
}: {
  onRow: (row: number) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  return (
    // The rows are a shortcut for the mouse; "Edit lines" in the header is the button for everyone.
    <div
      ref={box}
      className={cn("edit-rows", className)}
      title={label}
      onClick={(e) => {
        if (!box.current || window.getSelection()?.toString()) return;
        const row = rowOf(e.target, box.current);
        if (row !== null) onRow(row);
      }}
    >
      {children}
    </div>
  );
}

/**
 * In a table that just opened for editing: selects the row that was clicked
 * (its row number, as the line table's own click does) and brings it into
 * view. Nothing when the editor has no such row.
 */
export function useFocusRow(row: number | null, box: RefObject<HTMLElement | null>, done: () => void) {
  useEffect(() => {
    if (row === null) return;
    const t = window.setTimeout(() => {
      const th = box.current?.querySelector<HTMLElement>(`tbody tr[aria-rowindex="${row}"] > th[scope=row]`);
      const tr = th?.parentElement ?? box.current?.querySelectorAll<HTMLElement>("tbody tr")[row - 1];
      tr?.scrollIntoView({ block: "nearest" });
      th?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      done();
    }, 50);
    return () => window.clearTimeout(t);
  }, [row, box, done]);
}
