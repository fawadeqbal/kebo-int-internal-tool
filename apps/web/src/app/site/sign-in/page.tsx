import { AuthShell } from "@/app/login/auth-shell";
import { FindCompanyForm } from "./form";
import { sitePath } from "../links";

export const metadata = { title: "Sign in" };

/** "Sign in" from the marketing page: every company has its own address; this sends the right one by email. */
export default function FindCompanyPage() {
  return (
    <AuthShell
      subtitle="Sign in"
      footer={
        <a href={sitePath("/")} className="font-medium text-primary hover:underline">
          Back to RFQ Desk
        </a>
      }
    >
      <h1 className="text-lg font-semibold">Find your company&apos;s sign-in page</h1>
      <p className="mt-1 text-sm text-muted">
        Each company has its own address, like yourcompany.{process.env.BASE_DOMAIN ?? "rfq.example.com"}. Enter your work email and we will
        send you the link.
      </p>
      <FindCompanyForm />
    </AuthShell>
  );
}
