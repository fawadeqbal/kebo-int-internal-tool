import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import pg from "pg";

/** The restricted role company connections log in as (row-level security applies to it). */
export const COMPANY_ROLE = "kebo_app";

/**
 * The company role's password: derived from AUTH_SECRET, so every process (API,
 * worker, scripts) arrives at the same one and the server needs no new setting.
 * Changing AUTH_SECRET changes it too; the API sets the new one when it starts.
 */
export function companyRolePassword(authSecret: string): string {
  if (!authSecret) throw new Error("AUTH_SECRET is needed: the company connections' database password is made from it");
  return createHmac("sha256", authSecret).update("kebo_app-db-password").digest("hex");
}

/**
 * Where company connections connect: COMPANY_DATABASE_URL when it is set, else the
 * owner's DATABASE_URL with the company role's name and password in it.
 */
export function companyDatabaseUrl(ownerUrl: string, authSecret: string, override?: string | null): string {
  if (override?.trim()) return override.trim();
  const u = new URL(ownerUrl);
  u.username = COMPANY_ROLE;
  u.password = companyRolePassword(authSecret);
  return u.toString();
}

/** A SCRAM-SHA-256 verifier, so the password itself is never sent to the server (or its logs). */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** A SQL string literal (standard_conforming_strings is on since Postgres 9.1). */
export const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface RoleState {
  exists: boolean;
  login: boolean;
  superuser: boolean;
  bypassRls: boolean;
  memberOf: string[];
}

async function roleState(owner: pg.Client): Promise<RoleState> {
  const { rows } = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; member_of: string[] | null }>(
    `select r.rolcanlogin, r.rolsuper, r.rolbypassrls,
            array(select g.rolname::text from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) as member_of
       from pg_roles r where r.rolname = $1`,
    [COMPANY_ROLE],
  );
  const r = rows[0];
  return r
    ? { exists: true, login: r.rolcanlogin, superuser: r.rolsuper, bypassRls: r.rolbypassrls, memberOf: r.member_of ?? [] }
    : { exists: false, login: false, superuser: false, bypassRls: false, memberOf: [] };
}

/** Whether the company role can log in with this URL now. */
async function canLogIn(url: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/**
 * Makes the company role ready to log in, using the owner's connection (run by
 * the API when it starts, and by scripts before they open a company): LOGIN,
 * never a superuser, never past row-level security, a member of no other role
 * (so it cannot SET ROLE to the owner), with the password derived from
 * AUTH_SECRET. Changes nothing when it is already so. Returns what it changed.
 */
export async function prepareCompanyRole(ownerUrl: string, authSecret: string): Promise<string[]> {
  const companyUrl = companyDatabaseUrl(ownerUrl, authSecret);
  const owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 10_000 });
  await owner.connect();
  const done: string[] = [];
  try {
    const before = await roleState(owner);
    const attributesOk = before.exists && before.login && !before.superuser && !before.bypassRls && before.memberOf.length === 0;
    if (attributesOk && (await canLogIn(companyUrl))) return done;
    await owner.query("begin");
    // The API and a script starting at once: one at a time.
    await owner.query("select pg_advisory_xact_lock(hashtext('kebo_app-role'))");
    const now = await roleState(owner);
    const password = sqlLiteral(scramVerifier(companyRolePassword(authSecret)));
    if (!now.exists) {
      await owner.query(`CREATE ROLE ${COMPANY_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${password}`);
      done.push("created the role");
    } else {
      // Only what differs (changing SUPERUSER or BYPASSRLS needs a superuser owner).
      const attrs = [!now.login && "LOGIN", now.superuser && "NOSUPERUSER", now.bypassRls && "NOBYPASSRLS"].filter(Boolean).join(" ");
      await owner.query(`ALTER ROLE ${COMPANY_ROLE} WITH ${attrs} PASSWORD ${password}`);
      done.push(attrs ? `set ${attrs.toLowerCase()} and the password` : "set the password");
    }
    for (const role of now.memberOf) {
      await owner.query(`REVOKE ${pg.escapeIdentifier(role)} FROM ${COMPANY_ROLE}`);
      done.push(`removed it from ${role}`);
    }
    const db = (await owner.query<{ d: string }>("select current_database() as d")).rows[0]!.d;
    await owner.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(db)} TO ${COMPANY_ROLE}`);
    await owner.query("commit");
  } catch (e) {
    await owner.query("rollback").catch(() => undefined);
    throw new Error(`Could not prepare the database role ${COMPANY_ROLE} for company connections: ${(e as Error).message}`, { cause: e });
  } finally {
    await owner.end().catch(() => undefined);
  }
  return done;
}

/**
 * Refuses a company login that row-level security would not hold: a superuser,
 * a role that passes row-level security, or one that can become such a role
 * (SET ROLE). Run by the API at start, so a wrong COMPANY_DATABASE_URL stops it
 * rather than quietly opening every company to every other.
 */
export async function assertCompanyLogin(companyUrl: string): Promise<void> {
  const c = new pg.Client({ connectionString: companyUrl, connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ who: string; unsafe: string[] }>(
      `select session_user::text as who,
              array(select r.rolname::text from pg_roles r
                     where (r.rolsuper or r.rolbypassrls) and pg_has_role(session_user, r.oid, 'MEMBER')) as unsafe`,
    );
    const r = rows[0]!;
    if (r.unsafe.length) {
      throw new Error(
        `company connections log in as ${r.who}, which is or can become ${r.unsafe.join(", ")} (a superuser or a role past row-level security): every company could read every other. Use ${COMPANY_ROLE}.`,
      );
    }
  } finally {
    await c.end().catch(() => undefined);
  }
}
