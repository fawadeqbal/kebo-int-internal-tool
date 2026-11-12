import { Suspense, type ReactNode } from "react";
import { Toast } from "@kebo/ui/client";
import { Truck, TrendingUp, Wallet } from "lucide-react";

/**
 * The frame of sign-in, the two-step code and the public pages (request a demo, sign up), Kebo ERP
 * look. Phone first: the brand mark and the form. From a laptop up, a soft green panel on the left
 * says what the app does.
 */
export function AuthShell({
  children,
  wide = false,
  title = "Kebo ERP",
  subtitle = "Sign in to your company",
  footer,
  tag = true,
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
  /** From a laptop up, the subtitle over the form when one is given (sign-in shows its own). */
  tag?: boolean;
}) {
  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col justify-between gap-8 bg-primary-soft px-6 py-14 sm:p-14 lg:w-[55%]">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-solid text-xl font-bold text-primary-fg" aria-hidden>
            K
          </span>
          <span className="text-xl font-bold text-text">{title}</span>
        </div>
        <div>
          <p className="text-[44px] leading-[1.1] font-bold tracking-tight text-text">
            From the first inquiry
            <br />
            to the money in the bank.
          </p>
          <p className="mt-4 max-w-[520px] text-[17px] text-text-2">
            Inquiries, supplier offers, quotations, orders, shipping, documents and payments, for one trading company or many.
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:gap-3">
          {(
            [
              [TrendingUp, "Sales", "RFQ → quotation → order"],
              [Truck, "Operations", "Factories, shipping, papers"],
              [Wallet, "Money", "Payments, ledger, profit"],
            ] as const
          ).map(([Icon, name, line]) => (
            <li key={name} className="rounded-[14px] bg-surface p-3 sm:p-3.5">
              <Icon className="size-[22px] text-primary" aria-hidden />
              <p className="mt-2 text-sm font-bold text-text sm:text-base">{name}</p>
              <p className="text-xs text-muted sm:text-[13px]">{line}</p>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-10 lg:py-12">
        <div className={wide ? "w-full max-w-xl" : "w-full max-w-[400px]"}>
          {tag && subtitle !== "Sign in to your company" && (
            <p className="mb-6 text-sm font-medium text-text-2">{subtitle}</p>
          )}
          {children}
          {footer && <p className="mt-8 text-xs text-muted">{footer}</p>}
        </div>
      </div>
      <Suspense>
        <Toast />
      </Suspense>
    </main>
  );
}
