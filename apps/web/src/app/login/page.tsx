import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Alert } from "@kebo/ui";
import { AuthShell } from "./auth-shell";
import { BrandMark } from "./brand-mark";
import { LoginForm } from "./forms";
import { Splash } from "./splash";
import { WELCOMED_COOKIE } from "@/lib/welcome";
import { companyLook } from "@/lib/company-look";
import { demoMode } from "@/lib/demo";
import { PRODUCT_NAME } from "@/lib/product";

const DEMO_LOGINS = [
  { label: "Owner", hint: "Sees everything: money, profit, settings", email: "admin@example.com", password: "Admin@12345" },
  { label: "Manager", hint: "Reports, team and the money pages", email: "manager@example.com", password: "Manager@12345" },
  { label: "Sales person", hint: "Only their own inquiries and orders", email: "bilal@example.com", password: "Demo@12345" },
];

/** White label: the browser tab names the company at its own address, never the product. */
export async function generateMetadata(): Promise<Metadata> {
  const look = await companyLook();
  return { title: look ? { absolute: `Sign in · ${look.name}` } : "Sign in" };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; moved?: string }> }) {
  const { next, moved } = await searchParams;
  // At a company's own address: its name, logo and colours (white label); elsewhere the product's.
  const look = await companyLook();
  const name = look?.name ?? PRODUCT_NAME;
  // The welcome, only the first time this device opens the sign-in page (the splash sets the cookie).
  const welcomed = (await cookies()).has(WELCOMED_COOKIE);
  return (
    <AuthShell
      tag={false}
      footer={
        look ? (
          <p>Only invited members of {look.name} can sign in.</p>
        ) : (
          <p>
            New company?{" "}
            <Link href="/request-a-demo" className="font-semibold text-primary hover:underline">
              Request a demo
            </Link>
          </p>
        )
      }
    >
      {!welcomed && !demoMode() && (
        <Splash footer={`© ${new Date().getFullYear()} ${name}${look ? ". All rights reserved." : ""}`}>
          <BrandMark name={name} logoSrc={look?.logoSrc ?? null} size="splash" />
          {!look?.logoSrc && <p className="text-xl font-semibold tracking-tight text-text">{name}</p>}
        </Splash>
      )}
      {moved && (
        <Alert tone="info" className="mb-5">
          This is your company&apos;s new address. Sign in once more here, and bookmark it.
        </Alert>
      )}
      {/* Who you are signing in to: the company's logo, or its initials (board "Trusted sign in", White label). */}
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark name={name} logoSrc={look?.logoSrc ?? null} size="card" />
        <div>
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-text">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            {demoMode() ? (
              "This is a demo with sample data. Pick a person below to look around."
            ) : (
              <>
                to <strong className="font-semibold text-text">{name}</strong>
              </>
            )}
          </p>
        </div>
      </div>
      <LoginForm next={next} demo={demoMode() ? DEMO_LOGINS : undefined} />
    </AuthShell>
  );
}
