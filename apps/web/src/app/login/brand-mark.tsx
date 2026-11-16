import { initialsOf } from "@/lib/initials";

/**
 * The company's logo as it uploaded it, or its initials on a tile when it has none. On a dark page the logo sits
 * on a small white plate, so a dark logo on a clear background still reads.
 */
export function BrandMark({ name, logoSrc, size }: { name: string; logoSrc: string | null; size: "top" | "card" | "splash" }) {
  if (logoSrc)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small uploaded logo, served by our own route
      <img
        src={logoSrc}
        alt={`${name} logo`}
        className={
          size === "top"
            ? "h-8 w-auto max-w-[180px] object-contain dark:rounded-md dark:bg-white dark:px-2 dark:py-1"
            : size === "card"
              ? "h-14 w-auto max-w-[220px] object-contain dark:rounded-xl dark:bg-white dark:px-4 dark:py-3"
              : "h-20 w-auto max-w-[280px] object-contain dark:rounded-2xl dark:bg-white dark:px-5 dark:py-4"
        }
      />
    );
  const tile =
    size === "top"
      ? "size-[30px] rounded-lg text-[13px]"
      : size === "card"
        ? "size-14 rounded-[14px] text-xl ring-4 ring-primary-soft"
        : "size-20 rounded-[20px] text-[28px] ring-[6px] ring-primary-soft";
  return (
    <span className={`grid place-items-center bg-primary-solid font-bold tracking-wide text-primary-fg ${tile}`} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}
