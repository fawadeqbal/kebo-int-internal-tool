import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "../auth-shell";
import { companyLook } from "@/lib/company-look";
import { TwoStepForm } from "../forms";

/** White label: the browser tab names the company at its own address, never the product. */
export async function generateMetadata(): Promise<Metadata> {
  const look = await companyLook();
  return { title: look ? { absolute: `Two-step sign-in · ${look.name}` } : "Two-step sign-in" };
}

/**
 * Only for accounts with two-step sign-in on: the password was right and the API asks for the code
 * (loginAction sends people here on twoStepRequired; everyone else goes straight in). Board "Trusted sign in".
 */
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell tag={false}>
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span className="grid size-[52px] place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden>
          <ShieldCheck className="size-[26px]" />
        </span>
        <div>
          <h1 className="text-xl leading-7 font-semibold tracking-tight text-text">Two-step verification</h1>
          <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
        </div>
      </div>
      <div className="mt-6 text-center">
        <TwoStepForm next={next} />
      </div>
    </AuthShell>
  );
}
