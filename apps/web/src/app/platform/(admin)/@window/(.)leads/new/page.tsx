import { RouteWindow } from "@/components/common/route-window";
import { NewLeadForm } from "../../../leads/new/form";

/** Add a client inquiry, opened from a button: a window over the page you are on. */
export default function NewLeadWindow() {
  return (
    <RouteWindow title="Add a client inquiry" description="Someone who asked by phone, WhatsApp or in person." size="md">
      <NewLeadForm />
    </RouteWindow>
  );
}
