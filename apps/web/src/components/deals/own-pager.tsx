import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@kebo/ui";

/**
 * ‹ 2 of 5 › at the top right of a quotation's or an offer's own page: the inquiry's previous and next one
 * (design 17 Nov): `OwnPagerTop` beside the path on a wide screen, `OwnPagerUnder` under the title on a phone.
 */
export function OwnPager({
  label,
  what,
  at,
  of,
  prev,
  next,
  className,
}: {
  className?: string;
  /** "Quotations of RFQ-2026-0605". */
  label: string;
  /** "quotation", "offer". */
  what: string;
  at: number;
  of: number;
  prev: { href: string; name: string } | null;
  next: { href: string; name: string } | null;
}) {
  if (of < 2) return null;
  return (
    <nav aria-label={label} data-own-pager="" className={cn("flex items-center gap-1 text-[13px] font-semibold text-text-2", className)}>
      <PagerLink href={prev?.href ?? null} label={prev ? `Previous ${what}, ${prev.name}` : `No previous ${what}`}>
        <ChevronLeft className="size-4" aria-hidden />
      </PagerLink>
      <span className="px-1.5 tabular whitespace-nowrap">
        {at + 1} of {of}
      </span>
      <PagerLink href={next?.href ?? null} label={next ? `Next ${what}, ${next.name}` : `No next ${what}`}>
        <ChevronRight className="size-4" aria-hidden />
      </PagerLink>
    </nav>
  );
}

function PagerLink({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  const box = "grid size-7 place-items-center rounded-lg border border-line-strong bg-surface text-text";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cn(box, "hover:bg-surface-2")}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={cn(box, "opacity-40")}>
      {children}
    </span>
  );
}

type PagerProps = Parameters<typeof OwnPager>[0];

/** Beside the path, top right (laptop and up). */
export const OwnPagerTop = (p: PagerProps) => <OwnPager {...p} className="absolute -top-1.5 right-0 max-md:hidden" />;

/** Under the title (phone). */
export const OwnPagerUnder = (p: PagerProps) => <OwnPager {...p} className="mt-3 md:hidden" />;
