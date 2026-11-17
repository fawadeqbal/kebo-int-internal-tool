"use client";

import { useEffect, useState, type ReactNode } from "react";
import { WELCOMED_COOKIE } from "@/lib/welcome";

const SHOW_MS = 1200;
const FADE_MS = 400;

/**
 * The welcome, the first time this device opens the sign-in page: the company's logo and name in the middle of a
 * plain page for a moment, then it fades into the sign-in. A tap, a click or any key skips it; with reduced
 * motion it is shorter and does not fade. Hidden from screen readers, which go straight to the form.
 */
export function Splash({ children, footer }: { children: ReactNode; footer: string }) {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");
  useEffect(() => {
    document.cookie = `${WELCOMED_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = setTimeout(() => setPhase(still ? "gone" : "fade"), still ? 600 : SHOW_MS);
    const t2 = setTimeout(() => setPhase("gone"), still ? 600 : SHOW_MS + FADE_MS);
    const skip = () => setPhase("gone");
    addEventListener("keydown", skip, { once: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      removeEventListener("keydown", skip);
    };
  }, []);
  if (phase === "gone") return null;
  return (
    <div
      aria-hidden
      data-splash
      onClick={() => setPhase("gone")}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col border-t-[3px] border-primary-solid bg-bg transition-opacity ease-out ${phase === "fade" ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6">
        <div className="flex animate-in flex-col items-center gap-5">{children}</div>
        {/* A thin bar that fills while the welcome shows (board "Welcome splash"). */}
        <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-line">
          <div
            className="h-full w-full origin-left rounded-full bg-primary-solid motion-safe:animate-[splash-bar_var(--splash-ms)_ease-out_forwards]"
            style={{ ["--splash-ms" as string]: `${SHOW_MS}ms` }}
          />
        </div>
      </div>
      <p className="px-6 pb-7 text-center text-[13px] text-muted">{footer}</p>
    </div>
  );
}
