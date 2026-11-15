"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * A form's message after a save (what to fix, no connection, a refusal) is drawn at the top of the form's
 * scrolling body when it has one (PanelBody in a form box), so it sits inside the form with its padding, in
 * view; else at the top of the form. ActionForm gives the message; PanelBody claims the place.
 */
export const FormNotice = createContext<{ notice: ReactNode; claim: () => () => void } | null>(null);

/** In a form's body: draws the form's message here (and tells the form not to draw it above). */
export function useFormNotice(): ReactNode {
  const host = useContext(FormNotice);
  const claim = host?.claim;
  useEffect(() => claim?.(), [claim]);
  return host?.notice ?? null;
}
