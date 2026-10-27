import { CURRENCIES } from "@kebo/shared";

/** The currencies the business works in (USD, CNY, PKR), the main one first. */
export type SalesCurrencies = { sales: { currency: string; exchangeRates: Record<string, number> } };

export const currenciesFrom = (s: SalesCurrencies): string[] => [s.sales.currency, ...CURRENCIES.filter((c) => c !== s.sales.currency)];
