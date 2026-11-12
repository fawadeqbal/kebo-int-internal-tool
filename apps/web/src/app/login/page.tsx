import Link from "next/link";
import { Alert } from "@kebo/ui";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./forms";
import { demoMode } from "@/lib/demo";
import { addressCompany, apiFetch } from "@/lib/api";

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
  return (
    <AuthShell subtitle={company ?? undefined} tag={false}>
      {moved && (
        <Alert tone="info" className="mb-4">
          This is your company&apos;s new address. Sign in once more here, and bookmark it.
        </Alert>
      )}
      <h1 className="text-[28px] leading-9 font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-[15px] text-muted">
        {demoMode() ? "This is a demo with sample data. Pick a person below to look around." : (company ?? "Sign in to your company")}
      </p>
      {forgot && (
        <Alert tone="info" className="mt-4">
          Ask your company&apos;s admin for a new password: they send you a link to set one.
        </Alert>
      )}
      <LoginForm
        next={next}
        demo={demoMode() ? DEMO_LOGINS : undefined}
        forgotHref={`/login?forgot=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}
      />
      <p className="mt-4 text-center text-[13px] text-muted">
        New company?{" "}
        <Link href="/request-a-demo" className="font-semibold text-primary hover:underline">
          Request a demo
        </Link>
      </p>
    </AuthShell>
  );
}
