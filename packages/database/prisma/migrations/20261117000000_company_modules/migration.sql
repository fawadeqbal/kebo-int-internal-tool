-- Modules the platform admin can switch off per company, on top of its plan.
ALTER TABLE "companies" ADD COLUMN "features_off" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The order-flow modules are new: every existing plan gets them, so nobody loses
-- anything; the platform admin takes them out of a plan or a company as wanted.
UPDATE "plans"
SET "features" = (
  SELECT array_agg(DISTINCT f ORDER BY f)
  FROM unnest("features" || ARRAY['factory_requests','bank_contracts','production','shipping','bank_documents','delivery_sat','orders_board']::TEXT[]) AS f
);

-- The new order permissions go to every role that can move orders along today.
UPDATE "roles"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['shipping.manage','documents.manage','delivery.manage']::TEXT[]) AS p
)
WHERE 'orders.update' = ANY("permissions");
