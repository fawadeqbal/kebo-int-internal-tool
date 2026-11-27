"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { RULES } from "@kebo/ui";
import { numberOnSave } from "@/lib/format";
import { toast } from "@kebo/ui/client";
import { SidePanel, useSidePanel } from "@/components/common/panel";
import { DealForm, type RequestStep } from "@/components/deals/deal-form";
import { CouldNotLoad } from "@/components/common/could-not-load";

type FormProps = Omit<ComponentProps<typeof DealForm>, "onSaved" | "onAllSteps">;

/** A part's name in its window's title ("Items · RFQ-2611-0004"). */
const PART_TITLE: Record<RequestStep, string> = { customer: "customer", items: "items", details: "details", files: "files", review: "review", changes: "changes" };

/**
 * The inquiry's one window, in the side panel over the page it was opened from: "New inquiry"
 * (?panel=new-inquiry) and, the same window filled, "Edit the request" (?panel=edit-request).
 * A new one saved opens the inquiry; an edit closes it.
 */
export function InquiryPanel({
  refNo,
  customerName,
  inquiryTitle,
  numberHint,
  failed,
  ...form
}: FormProps & {
  refNo?: string;
  customerName?: string;
  inquiryTitle?: string;
  numberHint?: string;
  /** A part it starts from could not be read (the customer it was opened for): it says so above the form. */
  failed?: string | null;
}) {
  const router = useRouter();
  const edit = form.mode === "edit";
  const panel = useSidePanel(edit ? "edit-request" : "new-inquiry");
  // Edit on one part (the Items card's Edit, design 17 Nov): that part only, until "All steps".
  const [one, setOne] = useState(edit && !!form.only);
  return (
    <SidePanel
      // Design rules 18 Nov: "Edit customer" (one part, a smaller window but for the items), "Edit inquiry" (all parts).
      title={one ? `Edit ${PART_TITLE[form.startStep ?? "customer"]}` : edit ? "Edit inquiry" : "New inquiry"}
      description={edit ? [refNo, inquiryTitle ?? customerName].filter(Boolean).join(" · ") : numberOnSave((numberHint ?? "RFQ").split("-")[0]!)}
      onClose={() => panel.close()}
      className={one && form.startStep !== "items" ? RULES.window.part : RULES.window.items}
    >
      {failed && <CouldNotLoad compact what={failed} className="mb-3" />}
      <DealForm
        {...form}
        only={one}
        onAllSteps={() => setOne(false)}
        onSaved={(r) => {
          if (edit) {
            toast({ message: `Request saved · ${refNo ?? "the inquiry"}` });
            router.refresh();
            return panel.close();
          }
          // The new inquiry opens; the note says its number, what it is and for whom.
          const number = r.refNo ?? "The inquiry";
          toast({
            message: r.refNo ? `Inquiry ${r.refNo} added` : "Inquiry added",
            detail: [r.title, r.customer, r.files ? `${r.files} ${r.files === 1 ? "file" : "files"} attached` : null].filter(Boolean).join(" · ") || undefined,
            actions: r.refNo ? [{ label: "Copy number", run: () => void navigator.clipboard?.writeText(number) }] : undefined,
          });
          router.push(`/inquiries/${r.id}`);
        }}
      />
    </SidePanel>
  );
}
