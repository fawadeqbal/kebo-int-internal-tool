"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Whether the company's plan includes Excel (templates, uploads, exports). Set once by the app's layout. */
const ExcelAllowed = createContext(true);

export function ExcelAllowedProvider({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <ExcelAllowed.Provider value={allowed}>{children}</ExcelAllowed.Provider>;
}

export const useExcelAllowed = () => useContext(ExcelAllowed);
