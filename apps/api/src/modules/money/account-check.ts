import { DomainError } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

/**
 * The account money moved through, if one is named: it must exist, be in use,
 * and hold the same currency (a PKR cash box cannot receive dollars). Returns
 * the id to save, or null.
 */
export async function checkAccount(db: PrismaService["db"] | Tx, accountId: string | null | undefined, currency: string, keep?: string | null) {
  if (!accountId) return null;
  const a = await db.moneyAccount.findUnique({ where: { id: accountId }, select: { id: true, name: true, currency: true, archivedAt: true } });
  if (!a) throw new DomainError("That account is not in the system any more.");
  // A change that keeps the account it already had is fine even if the account was closed since.
  if (a.archivedAt && a.id !== keep) throw new DomainError(`${a.name} is closed. Choose another account.`);
  if (a.currency !== currency) throw new DomainError(`${a.name} holds ${a.currency}. Choose an account in ${currency}, or leave it empty.`);
  return a.id;
}
