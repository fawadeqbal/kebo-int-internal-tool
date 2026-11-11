/**
 * A party row holds what a customer has and what a supplier has. The Customers list and the
 * Suppliers list each give their own fields, so what the two return stays what it was.
 */

/** Left out of a customer: what only a supplier has. */
export const supplierOnly = { bankDetails: true, ownerId: true } as const;

/** Left out of a supplier: what only a customer has. */
export const customerOnly = { type: true, country: true, taxNo: true, regNo: true, defaultCurrency: true, initials: true } as const;
