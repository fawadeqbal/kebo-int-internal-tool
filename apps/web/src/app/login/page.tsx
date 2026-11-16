import Link from "next/link";
import { Alert } from "@kebo/ui";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./forms";
import { demoMode } from "@/lib/demo";
import { addressCompany, apiFetch } from "@/lib/api";
import { PRODUCT_NAME } from "@/lib/product";
import { initialsOf } from "@/lib/initials";

const DEMO_LOGINS = [
  { label: "Owner", hint: "Sees everything: money, profit, settings", email: "admin@example.com", password: "Admin@12345" },
  { label: "Manager", hint: "Reports, team and the money pages", email: "manager@example.com", password: "Manager@12345" },
  { label: "Sales person", hint: "Only their own inquiries and orders", email: "bilal@example.com", password: "Demo@12345" },
];

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; moved?: string; forgot?: string }> }) {
  const { next, moved, forgot } = await searchParams;
  // At a company's own address: its name over the form.
  const slug = await addressCompany();
  const res = slug ? await apiFetch(`/platform/public/company?slug=${encodeURIComponent(slug)}`, { auth: false }).catch(() => null) : null;
  // Its name only while it is switched on.
  const company = res?.ok ? ((await res.json()) as { name: string | null }).name : null;
  const name = company ?? PRODUCT_NAME;
  return (
    <AuthShell
      tag={false}
      footer={
        <>
          {company && <p>Only invited members of {company} can sign in. Every sign-in is recorded for your administrator.</p>}
          <p className={company ? "mt-3" : undefined}>
            New company?{" "}
            <Link href="/request-a-demo" className="font-semibold text-primary hover:underline">
              Request a demo
            </Link>
          </p>
        </>
      }
    >
      {moved && (
        <Alert tone="info" className="mb-5">
          This is your company&apos;s new address. Sign in once more here, and bookmark it.
        </Alert>
      )}
      {/* Who you are signing in to: the company's initials and name (board "Trusted sign in"). */}
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span
          className="grid size-[52px] place-items-center rounded-xl bg-primary-solid text-lg font-bold tracking-wide text-primary-fg ring-4 ring-primary-soft"
          aria-hidden
        >
          {initialsOf(name)}
        </span>
        <div>
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-text">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            {demoMode() ? (
              "This is a demo with sample data. Pick a person below to look around."
            ) : (
              <>
                to continue to <strong className="font-semibold text-text">{name}</strong>
              </>
            )}
          </p>
        </div>
      </div>
      {forgot && (
        <Alert tone="info" className="mt-5">
          Ask your company&apos;s admin for a new password: they send you a link to set one.
        </Alert>
      )}
      <LoginForm
        next={next}
        demo={demoMode() ? DEMO_LOGINS : undefined}
        forgotHref={`/login?forgot=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}
      />
    </AuthShell>
  );
}
