CREATE TABLE "packing_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"packing_list_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" varchar(20) DEFAULT 'pcs' NOT NULL,
	"packages" integer DEFAULT 1 NOT NULL,
	"package_type" varchar(40) DEFAULT 'Wooden case' NOT NULL,
	"net_weight" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross_weight" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cbm" numeric(12, 3) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packing_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pl_no" varchar(30) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"pack_date" date NOT NULL,
	"incoterm" varchar(60),
	"port_of_loading" varchar(120),
	"port_of_discharge" varchar(120),
	"final_destination" varchar(160),
	"transport" varchar(160),
	"container_no" varchar(200),
	"seal_no" varchar(120),
	"marks" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_lists_pl_no_unique" UNIQUE("pl_no")
);
--> statement-breakpoint
ALTER TABLE "packing_list_items" ADD CONSTRAINT "packing_list_items_packing_list_id_packing_lists_id_fk" FOREIGN KEY ("packing_list_id") REFERENCES "public"."packing_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packing_lists_invoice_idx" ON "packing_lists" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "packing_lists_query_idx" ON "packing_lists" USING btree ("query_id");