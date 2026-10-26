"use client";

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";

/**
 * Read first, edit on request: the card shows the saved values; "Edit" opens
 * the form in place, and saving or Cancel closes it again.
 */
export function EditableCard({
  title,
  description,
  read,
  editLabel = "Edit",
  edit,
}: {
  title: string;
  description?: ReactNode;
  read: ReactNode;
  editLabel?: string;
  /** The form; call `done()` after a successful save, or on Cancel. */
  edit: (done: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          !open && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
              <Pencil aria-hidden /> {editLabel}
            </Button>
          )
        }
      />
      <CardBody>{open ? edit(() => setOpen(false)) : read}</CardBody>
    </Card>
  );
}
