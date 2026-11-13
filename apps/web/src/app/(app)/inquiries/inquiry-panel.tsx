"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@kebo/ui/client";
import { SidePanel, useSidePanel } from "@/components/common/panel";
import { DealForm } from "@/components/deals/deal-form";

type FormProps = Omit<ComponentProps<typeof DealForm>, "onSaved">;

/**
 * The inquiry's one window, in the side panel over the page it was opened from: "New inquiry"
 * (?panel=new-inquiry) and, the same window filled, "Edit the request" (?panel=edit-request).
 * A new one saved opens the inquiry; "Save & add another" empties the window; an edit closes it.
 */
export function InquiryPanel({ refNo, customerName, numberHint, ...form }: FormProps & { refNo?: string; customerName?: string; numberHint?: string }) {
  const router = useRouter();
  const edit = form.mode === "edit";
  // "Save & add another": the window stays open with an empty form.
  const [round, setRound] = useState(0);
  const panel = useSidePanel(edit ? "edit-request" : "new-inquiry");
  return (
    <SidePanel
      key={round}
      title={edit ? "Edit the request" : "New inquiry"}
      description={edit ? [refNo, customerName].filter(Boolean).join(" · ") : `The number is given on save · ${numberHint ?? "RFQ"}-…`}
      onClose={() => panel.close()}
      className="md:w-[860px]"
    >
      <DealForm
        {...form}
        onSaved={(r) => {
          if (edit) {
            toast(`Saved · ${refNo ?? "the request"}`);
            router.refresh();
            return panel.close();
          }
          if (r.another) {
            toast({ message: `${r.refNo ?? "The inquiry"} is saved. Add the next one.`, action: { label: "Open", href: `/inquiries/${r.id}` } });
            router.refresh();
            return setRound((n) => n + 1);
          }
          router.push(`/inquiries/${r.id}`);
        }}
      />
    </SidePanel>
  );
}
