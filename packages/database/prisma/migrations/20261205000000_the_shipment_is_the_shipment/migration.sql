-- Single source of truth, PR 3: the shipment is the shipment (3 Nov 2026).
-- The B/L, the day the goods left, the container, the vessel, the ports and ETD/ETA are kept on the order's
-- shipments only. orders.shipped_on / bl_no / container_no go; every screen, paper, check and report reads
-- the shipments (Shipment 1, the first made, for the papers; "shipped on" = the earliest departed_on).
-- orders.port_of_discharge stays, as the contract destination (the default for a new shipment's port).
-- The B/L or AWB row of the document set no longer has a number of its own: it prints its shipment's.
--
-- What happens to existing data:
-- 1. An order with a ship date, B/L or container on the order (or a B/L number on its document set) and no
--    shipment gets Shipment 1 from them: mode sea (air when its set has an air waybill), status from the
--    order's stage (Done: arrived; Shipped, or a ship date: departed; else planned), ports from the order's
--    terms (E/F terms load at the Incoterm place; C/D terms discharge there, unless the order names its
--    destination). The history says so.
-- 2. An order that has shipments keeps the shipments' values. Where the order's own value differed (another
--    B/L, ship date or container), the order's old value is written into the history; where the shipment
--    had none, Shipment 1 takes the order's (what the papers printed until now). A ship date taken over
--    moves Shipment 1 on to "departed" if it was not that far.
-- 3. A B/L / AWB number typed on a row of the document set goes to that row's shipment (else Shipment 1)
--    when that has none; a different one is written into the history. The rows keep no number.
-- 4. The order's columns are dropped.
-- Papers already final keep what they printed (their snapshot); new versions read the shipment.
-- Shipments and history rows are company tables: company_id is taken from the order (row-level security and
-- the same-company triggers are unchanged). Everything here is set-based and safe on an empty database.

-- The order's own facts, with its primary shipment (the first made) and B/L numbers from its document set.
DROP TABLE IF EXISTS "sot3_orders";
CREATE TEMP TABLE "sot3_orders" AS
SELECT o."id" AS order_id, o."company_id", o."ref_no", o."stage", o."incoterm", o."incoterm_place", o."port_of_discharge",
       o."shipped_on", nullif(btrim(o."bl_no"), '') AS bl_no, nullif(btrim(o."container_no"), '') AS container_no,
       (SELECT s."id" FROM "shipments" s WHERE s."order_id" = o."id" ORDER BY s."created_at", s."id" LIMIT 1) AS primary_id,
       (SELECT nullif(btrim(d."number"), '') FROM "order_documents" d
         WHERE d."order_id" = o."id" AND d."kind" IN ('bill_of_lading', 'airway_bill') AND d."shipment_id" IS NULL AND nullif(btrim(d."number"), '') IS NOT NULL
         ORDER BY d."updated_at" DESC, d."id" LIMIT 1) AS doc_bl_no,
       EXISTS (SELECT 1 FROM "order_documents" d WHERE d."order_id" = o."id" AND d."kind" = 'airway_bill') AS air
  FROM "orders" o;

-- 1. Shipment 1 for orders that have shipping facts and no shipment.
INSERT INTO "shipments" ("id", "company_id", "order_id", "mode", "status", "bl_no", "container_no", "departed_on",
                         "port_of_loading", "port_of_discharge", "created_at", "updated_at")
SELECT gen_random_uuid(), x."company_id", x."order_id",
       (CASE WHEN x."air" THEN 'air' ELSE 'sea' END)::"ShipMode",
       (CASE WHEN x."stage" = 'done' THEN 'arrived'
             WHEN x."stage" = 'shipped' OR x."shipped_on" IS NOT NULL THEN 'departed'
             ELSE 'planned' END)::"ShipmentStatus",
       coalesce(x."bl_no", x."doc_bl_no"), x."container_no", x."shipped_on",
       CASE WHEN x."incoterm" IN ('EXW', 'FCA', 'FAS', 'FOB') THEN nullif(btrim(x."incoterm_place"), '') END,
       coalesce(nullif(btrim(x."port_of_discharge"), ''),
                CASE WHEN x."incoterm" NOT IN ('EXW', 'FCA', 'FAS', 'FOB') THEN nullif(btrim(x."incoterm_place"), '') END),
       now(), now()
  FROM "sot3_orders" x
 WHERE x."primary_id" IS NULL
   AND (x."shipped_on" IS NOT NULL OR x."bl_no" IS NOT NULL OR x."container_no" IS NOT NULL OR x."doc_bl_no" IS NOT NULL);

INSERT INTO "audit_logs" ("id", "company_id", "user_id", "action", "entity_type", "entity_id", "summary", "old_values", "new_values")
SELECT gen_random_uuid(), x."company_id", NULL, 'flow.shipment', 'order', x."order_id",
       x."ref_no" || ': ' || concat_ws(', ',
           CASE WHEN x."shipped_on" IS NOT NULL THEN 'ship date ' || to_char(x."shipped_on", 'YYYY-MM-DD') END,
           CASE WHEN coalesce(x."bl_no", x."doc_bl_no") IS NOT NULL THEN 'B/L ' || coalesce(x."bl_no", x."doc_bl_no") END,
           CASE WHEN x."container_no" IS NOT NULL THEN 'container ' || x."container_no" END)
         || ' moved from the order to Shipment 1 (one place for the shipment)',
       jsonb_strip_nulls(jsonb_build_object('shippedOn', to_char(x."shipped_on", 'YYYY-MM-DD'), 'blNo', coalesce(x."bl_no", x."doc_bl_no"), 'containerNo', x."container_no")),
       jsonb_strip_nulls(jsonb_build_object('step', 'shipping', 'shipmentId', s."id", 'departedOn', to_char(s."departed_on", 'YYYY-MM-DD'), 'blNo', s."bl_no", 'containerNo', s."container_no"))
  FROM "sot3_orders" x
  JOIN "shipments" s ON s."order_id" = x."order_id"
 WHERE x."primary_id" IS NULL;

-- 2. Orders that already had shipments: the order's values that differ from the shipments' go into the history.
WITH facts AS (
  SELECT x.*, s."bl_no" AS s_bl_no, s."container_no" AS s_container_no,
         (SELECT min(a."departed_on") FROM "shipments" a WHERE a."order_id" = x."order_id") AS s_shipped_on
    FROM "sot3_orders" x
    JOIN "shipments" s ON s."id" = x."primary_id"
), differs AS (
  SELECT f.*,
         (f."bl_no" IS NOT NULL AND f."s_bl_no" IS NOT NULL AND f."bl_no" <> f."s_bl_no") AS bl_differs,
         (f."shipped_on" IS NOT NULL AND f."s_shipped_on" IS NOT NULL AND f."shipped_on" <> f."s_shipped_on") AS date_differs,
         (f."container_no" IS NOT NULL AND f."s_container_no" IS NOT NULL AND f."container_no" <> f."s_container_no") AS container_differs
    FROM facts f
)
INSERT INTO "audit_logs" ("id", "company_id", "user_id", "action", "entity_type", "entity_id", "summary", "old_values", "new_values")
SELECT gen_random_uuid(), d."company_id", NULL, 'flow.shipment', 'order', d."order_id",
       d."ref_no" || ': the order''s own ' ||
         concat_ws(', ',
           CASE WHEN d."bl_differs" THEN 'B/L ' || d."bl_no" END,
           CASE WHEN d."date_differs" THEN 'ship date ' || to_char(d."shipped_on", 'YYYY-MM-DD') END,
           CASE WHEN d."container_differs" THEN 'container ' || d."container_no" END) ||
         ' differed from the shipment''s (' ||
         concat_ws(', ',
           CASE WHEN d."bl_differs" THEN 'B/L ' || d."s_bl_no" END,
           CASE WHEN d."date_differs" THEN 'left ' || to_char(d."s_shipped_on", 'YYYY-MM-DD') END,
           CASE WHEN d."container_differs" THEN 'container ' || d."s_container_no" END) ||
         '): the shipment''s is kept (one place for the shipment)',
       jsonb_strip_nulls(jsonb_build_object(
         'blNo', CASE WHEN d."bl_differs" THEN d."bl_no" END,
         'shippedOn', CASE WHEN d."date_differs" THEN to_char(d."shipped_on", 'YYYY-MM-DD') END,
         'containerNo', CASE WHEN d."container_differs" THEN d."container_no" END)),
       jsonb_strip_nulls(jsonb_build_object(
         'step', 'shipping',
         'shipmentId', d."primary_id",
         'blNo', CASE WHEN d."bl_differs" THEN d."s_bl_no" END,
         'shippedOn', CASE WHEN d."date_differs" THEN to_char(d."s_shipped_on", 'YYYY-MM-DD') END,
         'containerNo', CASE WHEN d."container_differs" THEN d."s_container_no" END))
  FROM differs d
 WHERE d."bl_differs" OR d."date_differs" OR d."container_differs";

-- ... and what Shipment 1 did not have, it takes from the order (what the papers printed until now).
UPDATE "shipments" s
   SET "bl_no" = coalesce(s."bl_no", x."bl_no"),
       "container_no" = coalesce(s."container_no", x."container_no"),
       "departed_on" = CASE WHEN x."shipped_on" IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM "shipments" a WHERE a."order_id" = x."order_id" AND a."departed_on" IS NOT NULL)
                            THEN x."shipped_on" ELSE s."departed_on" END,
       "status" = CASE WHEN x."shipped_on" IS NOT NULL AND s."status" IN ('planned', 'booked', 'loaded')
                        AND NOT EXISTS (SELECT 1 FROM "shipments" a WHERE a."order_id" = x."order_id" AND a."departed_on" IS NOT NULL)
                       THEN 'departed'::"ShipmentStatus" ELSE s."status" END,
       "updated_at" = now()
  FROM "sot3_orders" x
 WHERE s."id" = x."primary_id"
   AND ((s."bl_no" IS NULL AND x."bl_no" IS NOT NULL)
     OR (s."container_no" IS NULL AND x."container_no" IS NOT NULL)
     OR (x."shipped_on" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "shipments" a WHERE a."order_id" = x."order_id" AND a."departed_on" IS NOT NULL)));

-- 3. B/L / AWB numbers typed on the document set: to their shipment (else Shipment 1) when it has none; a
--    different one goes into the history. Then the rows keep no number (they print their shipment's).
DROP TABLE IF EXISTS "sot3_docs";
CREATE TEMP TABLE "sot3_docs" AS
SELECT d."id" AS doc_id, d."company_id", d."order_id", o."ref_no", nullif(btrim(d."number"), '') AS number,
       coalesce(d."shipment_id",
                (SELECT s."id" FROM "shipments" s WHERE s."order_id" = d."order_id" ORDER BY s."created_at", s."id" LIMIT 1)) AS shipment_id
  FROM "order_documents" d
  JOIN "orders" o ON o."id" = d."order_id"
 WHERE d."kind" IN ('bill_of_lading', 'airway_bill') AND nullif(btrim(d."number"), '') IS NOT NULL;

INSERT INTO "audit_logs" ("id", "company_id", "user_id", "action", "entity_type", "entity_id", "summary", "old_values", "new_values")
SELECT gen_random_uuid(), x."company_id", NULL, 'flow.shipment', 'order', x."order_id",
       x."ref_no" || ': the document set''s B/L ' || x."number" || ' differed from the shipment''s (' || s."bl_no" || '): the shipment''s is kept (one place for the shipment)',
       jsonb_build_object('documentId', x."doc_id", 'blNo', x."number"),
       jsonb_build_object('step', 'shipping', 'shipmentId', s."id", 'blNo', s."bl_no")
  FROM "sot3_docs" x
  JOIN "shipments" s ON s."id" = x."shipment_id"
 WHERE s."bl_no" IS NOT NULL AND s."bl_no" <> x."number";

UPDATE "shipments" s
   SET "bl_no" = x."number", "updated_at" = now()
  FROM (SELECT DISTINCT ON ("shipment_id") "shipment_id", "number" FROM "sot3_docs" WHERE "shipment_id" IS NOT NULL ORDER BY "shipment_id", "doc_id") x
 WHERE s."id" = x."shipment_id" AND s."bl_no" IS NULL;

UPDATE "order_documents" SET "number" = NULL WHERE "kind" IN ('bill_of_lading', 'airway_bill') AND "number" IS NOT NULL;

DROP TABLE "sot3_orders";
DROP TABLE "sot3_docs";

-- 4. The order's own copies go.
ALTER TABLE "orders" DROP COLUMN "shipped_on",
DROP COLUMN "bl_no",
DROP COLUMN "container_no";
