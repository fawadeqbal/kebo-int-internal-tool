"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The plan features the company has (see PLAN_FEATURES), for client components
 * that hide what the plan does not include. Set once by the app's layout;
 * null: unknown, so everything shows (the API still refuses what is off).
 */
const Features = createContext<string[] | null>(null);

export function FeaturesProvider({ features, children }: { features: string[] | null; children: ReactNode }) {
  return <Features.Provider value={features}>{children}</Features.Provider>;
}

export function useFeature(feature: string) {
  const f = useContext(Features);
  return !f || f.includes(feature);
}

/** Excel is a plan feature. */
export const useExcelAllowed = () => useFeature("excel");
