"use client";

import { useReportWebVitals } from "next/web-vitals";
import { report } from "@/lib/telemetry";

/** How fast each page showed its main part (largest contentful paint), for Dev tools › Speed and errors. */
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (metric.name === "LCP") report({ kind: "speed", page: location.pathname, ms: Math.round(metric.value) });
  });
  return null;
}
