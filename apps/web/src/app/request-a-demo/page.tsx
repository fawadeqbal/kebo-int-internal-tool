import { headers } from "next/headers";
import { AuthShell } from "@/app/login/auth-shell";
import { originOf } from "@/lib/origin";
import { sitePath } from "@/app/site/links";
import { RequestDemoForm } from "./form";

export const metadata = { title: "Request a demo" };

/** Public: someone who wants to see RFQ Desk. Their request reaches the platform admin as a lead. */
export default async function RequestDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Where they came from (the marketing page passes it on; else the link's tags and the referring site).
  const origin = originOf(await searchParams, (await headers()).get("referer"), "/request-a-demo");
  return (
    <AuthShell
      wide
      subtitle="Request a demo"
      footer={
        <>
          Already have an account?{" "}
          <a href={sitePath("/sign-in")} className="font-medium text-primary hover:underline">
            Sign in
          </a>
        </>
      }
    >
      <h1 className="text-lg font-semibold">See RFQ Desk with your own eyes</h1>
      <p className="mt-1 text-sm text-muted">
        Tell us a little about your company. We set up a demo with sample inquiries, quotations and orders for you to try for a few days.
      </p>
      <RequestDemoForm origin={origin} />
    </AuthShell>
  );
}
