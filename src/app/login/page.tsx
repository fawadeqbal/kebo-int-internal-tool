import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; ended?: string }> }) {
  const { next, ended } = await searchParams;
  const settings = await getSettings();
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-solid text-primary-fg shadow-card" aria-hidden>
            <svg viewBox="0 0 32 32" className="size-5">
              <path d="M8 10h16M8 16h11M8 22h7" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-text">{settings.companyName}</p>
            <p className="text-xs text-muted">RFQ Desk · staff only</p>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-text">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account your admin set up for you.</p>
          {ended && (
            <p role="status" className="mt-4 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-sm text-text">
              Your session ended (signed out, or the password was changed). Please sign in again.
            </p>
          )}
          <LoginForm next={next} />
        </Card>
        <p className="mt-6 text-center text-xs text-muted">Website, WhatsApp, WeChat and email RFQs, from first message to final invoice.</p>
      </div>
    </main>
  );
}
