import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";

/**
 * The kinds of the company's own costs. Plain values, so the server's page and the browser's windows both use them.
 */

const SHORT: Partial<Record<ExpenseCategory, string>> = { utilities: "Internet and bills", travel: "Travel", meals: "Meals", bank_charges: "Bank charges" };

/** A kind's short name ("Internet and bills" for electricity, internet and phone). */
export const companyKind = (c: ExpenseCategory) => SHORT[c] ?? EXPENSE_CATEGORY_LABEL[c] ?? c;
