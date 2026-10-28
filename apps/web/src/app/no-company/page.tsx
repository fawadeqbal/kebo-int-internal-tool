import Link from "next/link";
import { AuthShell } from "@/app/login/auth-shell";

export const metadata = { title: "No company here" };

/** An address with no company behind it (a typo, or a company that was removed). */
export default function NoCompanyPage() {
  return (
    <AuthShell subtitle="No company here">
      <h1 className="text-lg font-semibold">There is no company at this address</h1>
      <p className="mt-2 text-sm text-muted">
        Check the address you were given. If your company used to be here, ask your admin for its new address.
      </p>
      <Link href="/request-a-demo" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
        New here? Request a demo
      </Link>
    </AuthShell>
  );
}
