"use client";

import { useEffect } from "react";
import { COLOURS_COOKIE } from "@/lib/colours";

/** Keeps the company's colour set on this device for the sign-in pages (lib/colours.ts). Renders nothing. */
export function RememberColours({ colours }: { colours: string }) {
  useEffect(() => {
    document.cookie = `${COLOURS_COOKIE}=${encodeURIComponent(colours)}; path=/; max-age=31536000; samesite=lax`;
  }, [colours]);
  return null;
}
