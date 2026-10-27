-- Step 4: roles become rows (made and edited under Security), two-step sign-in
-- required per role, the IP of each session, and the sign-in history.

CREATE TYPE "SignInResult" AS ENUM ('signed_in', 'code_needed', 'wrong_password', 'unknown_email', 'wrong_code', 'locked', 'switched_off', 'too_many');

CREATE TABLE "roles" (
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "super_admin" BOOLEAN NOT NULL DEFAULT false,
    "require_two_step" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- The three roles there were, with the same permissions as before.
INSERT INTO "roles" ("key", "name", "description", "permissions", "super_admin", "updated_at") VALUES
  ('admin', 'Super Admin', 'Everything, always, including permissions added later.', ARRAY[]::text[], true, now()),
  ('manager', 'Manager', 'Sees and changes everything, assigns work, sees money and reports.', ARRAY['dashboard.view', 'reports.view', 'inquiries.create', 'inquiries.viewAll', 'inquiries.updateAny', 'inquiries.assign', 'inquiries.reopen', 'inquiries.delete', 'customers.manage', 'customers.delete', 'customers.export', 'quotations.manage', 'sourcing.manage', 'orders.manage', 'orders.update', 'payments.record', 'expenses.manage', 'audit.view']::text[], false, now()),
  ('staff', 'Staff', 'Works the deals and orders they handle; sees only their own customers.', ARRAY['dashboard.view', 'inquiries.create', 'customers.manage', 'quotations.manage', 'sourcing.manage', 'orders.update']::text[], false, now());

-- users.role: from the enum to the role's key.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE VARCHAR(40) USING "role"::text;
ALTER TABLE "users" ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP TYPE "Role";

ALTER TABLE "sessions" ADD COLUMN "ip" VARCHAR(64);

CREATE TABLE "sign_ins" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" VARCHAR(254) NOT NULL,
    "result" "SignInResult" NOT NULL,
    "detail" VARCHAR(120),
    "ip" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(300),
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_ins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sign_ins_at_idx" ON "sign_ins"("at");
CREATE INDEX "sign_ins_user_id_at_idx" ON "sign_ins"("user_id", "at");
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
