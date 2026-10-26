CREATE TABLE "supplier_quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_quote_id" uuid NOT NULL,
	"query_item_id" uuid,
	"description" text NOT NULL,
	"model" varchar(120),
	"quantity" numeric(12, 2) NOT NULL,
	"unit" varchar(20) DEFAULT 'pcs' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"reference" varchar(80),
	"quoted_on" date NOT NULL,
	"valid_until" date,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"prices_include_vat" boolean DEFAULT true NOT NULL,
	"price_basis" varchar(60),
	"lead_time" varchar(120),
	"payment_terms" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_person" varchar(120),
	"phone" varchar(40),
	"wechat" varchar(80),
	"email" varchar(254),
	"address" text,
	"default_vat_rate" numeric(5, 2) DEFAULT '13' NOT NULL,
	"bank_details" text,
	"notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "query_items" ADD COLUMN "chosen_offer_item_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "supplier_quote_item_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "unit_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "fx_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_supplier_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("supplier_quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_query_item_id_query_items_id_fk" FOREIGN KEY ("query_item_id") REFERENCES "public"."query_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_quote_items_quote_idx" ON "supplier_quote_items" USING btree ("supplier_quote_id");--> statement-breakpoint
CREATE INDEX "supplier_quotes_query_idx" ON "supplier_quotes" USING btree ("query_id");--> statement-breakpoint
CREATE INDEX "supplier_quotes_supplier_idx" ON "supplier_quotes" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
ALTER TABLE "query_items" ADD CONSTRAINT "query_items_chosen_offer_item_id_supplier_quote_items_id_fk" FOREIGN KEY ("chosen_offer_item_id") REFERENCES "public"."supplier_quote_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_supplier_quote_item_id_supplier_quote_items_id_fk" FOREIGN KEY ("supplier_quote_item_id") REFERENCES "public"."supplier_quote_items"("id") ON DELETE set null ON UPDATE no action;