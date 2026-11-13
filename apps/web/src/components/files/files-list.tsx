"use client";

import { X } from "lucide-react";
import { Alert, Button } from "@kebo/ui";

/** A small alert for a dropped file that could not be kept. */
export function DropError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed right-4 bottom-4 z-[95] max-w-sm">
      <Alert tone="error">
        <span className="flex items-start gap-2">
          <span className="flex-1">{message}</span>
          <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </span>
      </Alert>
    </div>
  );
}
