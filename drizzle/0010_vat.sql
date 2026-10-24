ALTER TABLE "customers" ADD COLUMN "vat_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One VAT for the whole system: the old "default tax rate" becomes the VAT rate; prices are VAT-exclusive unless the super admin switches it.
UPDATE "settings" SET "value" = ("value" - 'defaultTaxRate') || jsonb_build_object('vatRate', coalesce("value"->'defaultTaxRate', '0'::jsonb), 'pricesIncludeVat', false)
 WHERE "key" = 'app' AND "value" ? 'defaultTaxRate';
