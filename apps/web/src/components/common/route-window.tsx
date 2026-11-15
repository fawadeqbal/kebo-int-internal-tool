"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { lockScroll } from "@/lib/scroll-lock";
import { Button, ButtonLink, cn } from "@kebo/ui";
import { useChanges, watchChanges } from "./changes";
import { focusables, ThrowAwayConfirm, useBackGuard, useFocusTrap, useMounted, WINDOW_BOX, WINDOW_LAYER, WindowHead } from "./dialog";
import { PanelCloseProvider, PanelFooter, useClosePanel } from "./panel";

/** Inside a RouteWindow: called by a form once it saved, to close the window (back to the page under it). */
const WindowDone = createContext<(() => void) | null>(null);
export const useWindowDone = () => useContext(WindowDone);

const WIDTH = { md: "md:w-[600px]", lg: "md:w-[760px]", xl: "md:w-[900px]" } as const;

/**
 * A whole page shown as a window over the page you were on (Record payment, New company): the same frame
 * as every other window. Opened by a link (an intercepted route, so the page under it stays), closed by ✕,
 * Escape, a click beside it, or saving: each goes Back to the page under it. Opened from a new tab or a
 * reload, the page itself shows instead.
 */
export function RouteWindow({
  title,
  description,
  size = "lg",
  children,
}: {
  title: string;
  description?: ReactNode;
  size?: keyof typeof WIDTH;
  children: ReactNode;
}) {
  const router = useRouter();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const changes = useChanges(box);
  const [asking, setAsking] = useState(false);
  const [closed, setClosed] = useState(false);
  useFocusTrap(box, mounted);
  useEffect(() => lockScroll(), []);
  // Another kind or record chosen inside the window (its address changed): a new form, nothing changed yet.
  const params = useSearchParams().toString();
  useEffect(() => changes.saved(), [params, changes]);
  useEffect(() => {
    if (!mounted || !box.current) return;
    const first = focusables(box.current).find((el) => el.matches("input,select,textarea"));
    (first ?? head.current)?.focus({ preventScroll: true });
    // Start at the top (the tabs and the first choice), whatever focusing scrolled.
    if (body.current) body.current.scrollTop = 0;
  }, [mounted]);

  const leave = useCallback(() => {
    setClosed(true);
    router.back();
  }, [router]);
  const request = () => {
    if (changes.changed()) setAsking(true);
    else leave();
  };
  // The phone's Back closes it by itself (it is a page in the address); with something typed it asks first.
  useBackGuard(request, () => changes.changed());

  if (!mounted || closed) return null;
  return (
    <div className={cn(WINDOW_LAYER, "z-[80]")}>
      <div aria-hidden className="absolute inset-0 animate-in bg-black/40" onClick={request} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        {...watchChanges(changes)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if ((e.target as HTMLElement).closest("[role=menu],[role=listbox],[role=alertdialog]")) return;
          e.preventDefault();
          request();
        }}
        className={cn(WINDOW_BOX, WIDTH[size])}
      >
        <WindowHead id={id} title={title} description={description} onClose={request} headRef={head} />
        <div ref={body} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 *:shrink-0 sm:px-6">
          <WindowDone.Provider value={leave}>
            <PanelCloseProvider value={(arg) => (arg && typeof arg === "object" && (arg as { ok?: boolean }).ok ? leave() : request())}>{children}</PanelCloseProvider>
          </WindowDone.Provider>
        </div>
      </div>
      {asking && (
        <ThrowAwayConfirm
          what={title}
          onKeep={() => setAsking(false)}
          onThrow={() => {
            setAsking(false);
            leave();
          }}
        />
      )}
    </div>
  );
}

/**
 * A form's Cancel and save: in a window, the window's footer at the bottom right (Cancel closes it, asking
 * first when something changed); as a page, the same buttons at the end of the form (Cancel goes to `cancelHref`).
 */
export function FormButtons({ children, cancelHref }: { children: ReactNode; cancelHref?: string }) {
  const inWindow = useWindowDone() !== null;
  const close = useClosePanel();
  if (inWindow)
    return (
      <PanelFooter>
        <Button type="button" variant="ghost" onClick={() => close()}>
          Cancel
        </Button>
        {children}
      </PanelFooter>
    );
  return (
    <div className="flex flex-wrap justify-end gap-3">
      {cancelHref && (
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      )}
      {children}
    </div>
  );
}
