import { redirect } from "next/navigation";

/** Payment requests moved under Treasury › Payments (the Payment requests tab): old links still work. */
export default function PaymentRequestsMoved() {
  redirect("/money/due");
}
