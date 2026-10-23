import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const settings = await getSettings();
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm font-semibold tracking-wide">{settings.companyName}</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Every customer query, from first call to final invoice.</h1>
          <p className="mt-4 text-base text-white/70">
            Record specifications and files, assign work, track progress, send quotations and issue invoices — all in one place.
          </p>
        </div>
        <ol className="grid grid-cols-4 gap-3 text-xs text-white/70">
          {["Query", "Processing", "Quotation", "Invoice"].map((step, i) => (
            <li key={step} className="border-t border-white/25 pt-3">
              <span className="block font-mono text-white/40">0{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-sm font-semibold">{settings.companyName}</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use the account your administrator created for you.</p>
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20 lg:bg-white/10 max-lg:bg-brand-600">
      <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
        <path d="M8 10h16M8 16h11M8 22h7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
