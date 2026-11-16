import { Suspense, type ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { Toast } from "@kebo/ui/client";
import { Lock } from "lucide-react";
import { COLOURS_COOKIE, savedColours } from "@/lib/colours";
import { PRODUCT_NAME } from "@/lib/product";

/**
 * The frame of sign-in, the two-step code, setting a password and the public pages (request a demo, sign up).
 * Board "Trusted sign in": a quiet page in the app's own colours (the company's set last used on this device,
 * light or dark as the person chose), a thin brand line on top, one card in the middle and under it the address
 * the person is signing in at. No selling words: the card says what this page is and nothing more.
 */
export async function AuthShell({
  children,
  wide = false,
  title = PRODUCT_NAME,
  subtitle,
  footer,
  tag = true,
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
  /** A small line over the card's content (sign-in shows its own heading). */
  subtitle?: string;
  footer?: ReactNode;
  /** Show the subtitle over the content (on by default). */
  tag?: boolean;
}) {
  const colours = savedColours((await cookies()).get(COLOURS_COOKIE)?.value);
  const host = (await headers()).get("host");
  return (
    <div className="flex min-h-dvh flex-col border-t-[3px] border-primary-solid bg-bg">
      {/* The page takes this set's colours from the first paint (packages/ui/src/styles/theme.css). */}
      <span id="app-colours" data-colours={colours} hidden />
      <header className="flex items-center gap-2.5 px-5 py-5 sm:px-8">
        <span className="grid size-7 place-items-center rounded-[7px] bg-primary-solid text-sm font-bold text-primary-fg" aria-hidden>
          K
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-text">{title}</span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pt-2 pb-10">
        <div className={wide ? "w-full max-w-xl" : "w-full max-w-[420px]"}>
          <div className="rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_28px_rgb(0_0_0/0.06)]">
            <div className="p-6 sm:p-9">
              {tag && subtitle && <p className="mb-4 text-sm font-medium text-text-2">{subtitle}</p>}
              {children}
            </div>
            {host && (
              <p className="flex items-center justify-center gap-1.5 rounded-b-[14px] border-t border-line bg-faint px-5 py-3.5 text-[13px] font-medium text-text-2">
                <Lock className="size-3.5 text-primary" aria-hidden />
                <span className="sr-only">Secure address: </span>
                {host}
              </p>
            )}
          </div>
          {footer && <div className="mx-auto mt-5 max-w-[420px] text-center text-[13px] leading-relaxed text-muted">{footer}</div>}
        </div>
      </main>
      <footer className="px-6 pb-7 text-center text-[13px] text-muted">
        © {new Date().getFullYear()} {PRODUCT_NAME}
      </footer>
      <Suspense>
        <Toast />
      </Suspense>
    </div>
  );
}
