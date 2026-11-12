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
  footer = "From the first inquiry to the money in the bank.",
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="hidden flex-col justify-between gap-10 bg-primary-soft p-12 lg:flex lg:w-[46%] xl:p-16">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-solid text-xl font-bold text-primary-fg" aria-hidden>
            K
          </span>
          <span className="text-xl font-bold text-text">{title}</span>
        </div>
        <div>
          <p className="max-w-lg text-[40px] leading-[1.1] font-bold tracking-tight text-text">From the first inquiry to the money in the bank.</p>
          <p className="mt-4 max-w-md text-base text-text-2">Inquiries, factory offers, quotations, orders, shipping, papers and payments, for one trading company or many.</p>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {(
            [
              [TrendingUp, "Sales", "Inquiry → quotation → order"],
              [Truck, "Operations", "Factories, shipping, papers"],
              [Wallet, "Money", "Payments, ledger, profit"],
            ] as const
          ).map(([Icon, name, line]) => (
            <li key={name} className="rounded-2xl bg-surface p-4">
              <Icon className="size-5 text-primary" aria-hidden />
              <p className="mt-2 text-sm font-bold text-text">{name}</p>
              <p className="text-xs text-text-2">{line}</p>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex flex-1 items-center justify-center bg-surface px-4 py-10 sm:px-8">
        <div className={wide ? "w-full max-w-xl" : "w-full max-w-sm"}>
          <div className="mb-8 flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-solid text-xl font-bold text-primary-fg lg:hidden" aria-hidden>
              K
            </span>
            <div className="leading-tight lg:hidden">
              <p className="font-bold text-text">{title}</p>
              <p className="text-xs text-text-2">{subtitle}</p>
            </div>
            <p className="hidden text-sm font-medium text-text-2 lg:block">{subtitle}</p>
          </div>
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
