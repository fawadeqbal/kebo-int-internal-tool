import Link from "next/link";
import { AuthShell } from "@/app/login/auth-shell";
import { RequestDemoForm } from "./form";

export const metadata = { title: "Request a demo" };

/** Public: someone who wants to see RFQ Desk. Their request reaches the platform admin as a lead. */
export default function RequestDemoPage() {
  return (
    <AuthShell
      wide
      subtitle="Request a demo"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <h1 className="text-lg font-semibold">See RFQ Desk with your own eyes</h1>
      <p className="mt-1 text-sm text-muted">
        Tell us a little about your company. We set up a demo with sample inquiries, quotations and orders for you to try for a few days.
      </p>
      <RequestDemoForm />
    </AuthShell>
  );
}
