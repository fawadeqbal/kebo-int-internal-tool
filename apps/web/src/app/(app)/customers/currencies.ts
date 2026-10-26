/** The currencies the business works in: the main one first, then each one with an exchange rate in Settings. */
export type SalesCurrencies = { sales: { currency: string; exchangeRates: Record<string, number> } };

export const currenciesFrom = (s: SalesCurrencies) => [...new Set([s.sales.currency, ...Object.keys(s.sales.exchangeRates)])];
