import type { Prisma } from "./generated/prisma/client";

/**
 * Customers and suppliers are one table, parties; a row in party_roles says which list a party is on
 * (one party can be on both). These are the only places that spell a role out: lists and look-ups
 * filter with isCustomer / isSupplier, and a new party is made with newCustomer / newSupplier.
 */
export const isCustomer = { roles: { some: { role: "customer" } } } as const satisfies Prisma.PartyWhereInput;
export const isSupplier = { roles: { some: { role: "supplier" } } } as const satisfies Prisma.PartyWhereInput;

/** A new customer's row: the customer role, and US dollars unless another currency is given. */
export const newCustomer = <T extends object>(data: T) => ({ defaultCurrency: "USD", ...data, roles: { create: { role: "customer" as const } } });

/** A new supplier's row: the supplier role. */
export const newSupplier = <T extends object>(data: T) => ({ ...data, roles: { create: { role: "supplier" as const } } });

/** The role rows for parties made together (createMany cannot make them in the same call). */
export const roleRows = (role: "customer" | "supplier", parties: { id: string }[]) => parties.map((p) => ({ partyId: p.id, role }));
