-- Insights: monthly sales targets, and reminders a person marked done or put off.
-- CreateTable
CREATE TABLE "sales_targets" (
    "month" CHAR(7) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "reminder_states" (
    "user_id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "snoozed_until" DATE,
    "done_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reminder_states_pkey" PRIMARY KEY ("user_id","key")
);


ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_month_check" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "reminder_states" ADD CONSTRAINT "reminder_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
