import { asc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { users } from "@/lib/db/schema";

const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  twoStepOn: sql<boolean>`${users.totpEnabledAt} is not null`,
};

export const listUsers = () => db.select(publicColumns).from(users).orderBy(asc(users.name));

export const listActiveUsers = () =>
  db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));

export async function findUserById(id: string, tx: DbOrTx = db) {
  const [row] = await tx.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByEmailWithHash(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}
