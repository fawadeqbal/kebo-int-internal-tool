import { Suspense, type ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { Toast } from "@kebo/ui/client";
import { Lock, ShieldCheck, Users } from "lucide-react";
import { COLOURS_COOKIE, savedColours } from "@/lib/colours";
import { companyLook } from "@/lib/company-look";
import { PRODUCT_NAME } from "@/lib/product";
import { BrandMark } from "./brand-mark";

/**
 * The frame of sign-in, the two-step code, setting a password and the public pages (request a demo, sign up).
 * Board "Trusted sign in": a quiet page in the app's own colours (the company's set last used on this device,
 * light or dark as the person chose), a thin brand line on top, one card in the middle and under it the address
 * the person is signing in at. No selling words: the card says what this page is and nothing more.
 * White label: at a company's own address the top, the colours and the © line are the company's (its logo, or
 * its initials and name) and the product's name is nowhere on the page (lib/company-look.ts).
 */
export async function AuthShell({
  children,
  wide = false,
  title = PRODUCT_NAME,
  subtitle,
  footer,
  tag = true,
  side = false,
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
  /** A small line over the card's content (sign-in shows its own heading). */
  subtitle?: string;
  footer?: ReactNode;
  /** Show the subtitle over the content (on by default). */
  tag?: boolean;
  /**
   * Board "Trusted sign-in, refined", Laptop B: at a company's own address, the company's panel on the left on a
   * laptop (its logo, its address and what is true of this sign-in) and the form on the page beside it; on a
   * phone no card, the form fills the screen and the address and © line sit at the bottom.
   */
  side?: boolean;
}) {
  const look = await companyLook();
  const colours = look?.colours ?? savedColours((await cookies()).get(COLOURS_COOKIE)?.value);
  const host = (await headers()).get("host");
  const copyright = `© ${new Date().getFullYear()} ${look ? `${look.name}. All rights reserved.` : PRODUCT_NAME}`;
  if (side && look) {
    const brand = (
      <>
        <BrandMark name={look.name} logoSrc={look.logoSrc} size="top" />
        {!look.logoSrc && <span className="min-w-0 truncate text-lead font-semibold tracking-tight text-text">{look.name}</span>}
      </>
    );
    const address = host && (
      <span className="inline-flex items-center gap-1.5 text-md font-medium text-text-2">
        <Lock className="size-3.5 text-primary" aria-hidden />
        <span className="sr-only">Secure address: </span>
        {host}
      </span>
    );
    const facts = [
      { icon: Lock, title: "A secure address", line: `${host ?? "This address"} belongs to ${look.name}. Check it in the address bar before you type your password.` },
      { icon: Users, title: "Members only", line: `Only people ${look.name} invited can sign in. Ask your manager for an invite.` },
      { icon: ShieldCheck, title: "Two-step for those who use it", line: "If your account has two-step on, a 6-digit code from your app comes next." },
    ];
    return (
      <div className="flex min-h-dvh border-t-[3px] border-primary-solid bg-bg lg:border-t-0">
        <span id="app-colours" data-colours={colours} hidden />
        <aside className="hidden w-[44%] max-w-[560px] shrink-0 flex-col justify-between gap-10 border-r border-line bg-surface-2 px-14 py-12 lg:flex">
          <div className="flex min-w-0 items-center gap-3">{brand}</div>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col items-start gap-3.5">
              <h2 className="text-2xl leading-8 font-semibold tracking-tight text-text">Your company&apos;s own sign-in</h2>
              {address && <span className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3">{address}</span>}
            </div>
            <ul className="flex flex-col gap-5 border-t border-line pt-6">
              {facts.map((f) => (
                <li key={f.title} className="flex gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary" aria-hidden>
                    <f.icon className="size-[18px]" />
                  </span>
                  <span>
                    <span className="block text-base font-semibold text-text">{f.title}</span>
                    <span className="mt-0.5 block text-sm leading-5 text-text-2">{f.line}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-md text-muted">{copyright}</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 min-w-0 shrink-0 items-center gap-2.5 px-5 lg:hidden">{brand}</header>
          <main className="flex flex-1 flex-col items-center px-5 pt-5 pb-8 sm:justify-center lg:px-12">
            <div className="w-full max-w-[400px]">
              {tag && subtitle && <p className="mb-4 text-sm font-medium text-text-2">{subtitle}</p>}
              {children}
              {footer && <div className="mt-6 text-center text-md leading-relaxed text-muted lg:hidden">{footer}</div>}
            </div>
          </main>
          <footer className="flex shrink-0 flex-col items-center gap-1.5 border-t border-line px-5 pt-3.5 pb-6 lg:hidden">
            {address}
            <span className="text-xs text-muted">{copyright}</span>
          </footer>
        </div>
        <Suspense>
          <Toast />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col border-t-[3px] border-primary-solid bg-bg">
      {/* The page takes this set's colours from the first paint (packages/ui/src/styles/theme.css). */}
      <span id="app-colours" data-colours={colours} hidden />
      <header className="flex min-h-[72px] items-center gap-2.5 px-5 py-4 sm:px-8">
        {look ? (
          look.logoSrc ? (
            <BrandMark name={look.name} logoSrc={look.logoSrc} size="top" />
          ) : (
            <>
              <BrandMark name={look.name} logoSrc={null} size="top" />
              <span className="text-lead font-semibold tracking-tight text-text">{look.name}</span>
            </>
          )
        ) : (
          <>
            <span className="grid size-7 place-items-center rounded-[7px] bg-primary-solid text-sm font-bold text-primary-fg" aria-hidden>
              K
            </span>
            <span className="text-lead font-semibold tracking-tight text-text">{title}</span>
          </>
        )}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pt-2 pb-10">
        <div className={wide ? "w-full max-w-xl" : "w-full max-w-[420px]"}>
          <div className="rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_28px_rgb(0_0_0/0.06)]">
            <div className="p-6 sm:p-9">
              {tag && subtitle && <p className="mb-4 text-sm font-medium text-text-2">{subtitle}</p>}
              {children}
            </div>
            {host && (
              <p className="flex items-center justify-center gap-1.5 rounded-b-[14px] border-t border-line bg-faint px-5 py-3.5 text-md font-medium text-text-2">
                <Lock className="size-3.5 text-primary" aria-hidden />
                <span className="sr-only">Secure address: </span>
                {host}
              </p>
            )}
          </div>
          {footer && <div className="mx-auto mt-5 max-w-[420px] text-center text-md leading-relaxed text-muted">{footer}</div>}
        </div>
      </main>
      <footer className="px-6 pb-7 text-center text-md text-muted">
        {copyright}
      </footer>
      <Suspense>
        <Toast />
      </Suspense>
    </div>
  );
}
