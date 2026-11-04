-- The main contact's phone or WhatsApp on a company (the platform admin's company page, Details → Main contact).
-- A platform table: no row-level security.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "contact_phone" VARCHAR(40);
