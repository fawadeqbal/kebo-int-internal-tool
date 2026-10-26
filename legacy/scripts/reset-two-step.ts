/**
 * Last resort when the Super Admin lost both phone and recovery codes:
 *   docker compose exec app node dist/scripts/reset-two-step.js you@example.com
 * Turns two-step sign-in off for that account and signs it out everywhere;
 * it is asked to set it up again at the next sign-in. Recorded in the audit log.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: node dist/scripts/reset-two-step.js <email>");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw new Error(`No user with email ${email}`);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null, failedLogins: 0, lockedUntil: null })
      .where(eq(schema.users.id, user.id));
    await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, user.id));
    await tx.insert(schema.auditLogs).values({ userId: null, action: "two_step_reset", entityType: "user", entityId: user.id, summary: `Two-step sign-in reset for ${email} from the server command line` });
  });
  console.log(`[reset-two-step] ${email}: two-step sign-in reset and signed out everywhere; set it up again at next sign-in`);
}

main()
  .catch((e) => {
    console.error("[reset-two-step] failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
