# Factory prices: tax included or not, 0% by default

Approved 3 Nov 2026 from canvas page 27 (board /home/claude/canvas/project/Fix27Tax.dc.html, preview
/home/claude/preview/Fix27Tax.png).

Today: FactoryQuoteLine.taxRate defaults to 13 (shared DEFAULT_TAX_RATE = 13 in
packages/shared/src/workflows/tax.ts); unitPrice is "without tax"; our cost = price + tax. Orders freeze
factoryUnitPrice/factoryTaxRate on order lines.

## Changes
1. Data: FactoryQuote gets `taxIncluded Boolean @default(false)` and `taxRate Decimal(5,2) @default(0)`
   (the offer's rate, applied to its lines). Migration `20261203000000_factory_tax` (must sort after
   20261130000000; follow the RLS/grant conventions of earlier migrations — plain columns need no policy
   change). Existing offers: set the offer's taxRate from its lines (most common line rate, else 13) and
   taxIncluded = false, so nothing already entered changes. FactoryQuoteLine.taxRate default becomes 0;
   lines keep their own rate (a line may differ from the offer). Order lines: also freeze
   `factoryTaxIncluded Boolean @default(false)` beside factoryTaxRate.
2. Shared: DEFAULT_TAX_RATE = 0; one function for a line's cost:
   without tax → unit × (1 + r/100); included → unit (the tax inside = unit − unit/(1 + r/100), shown
   only). Use it everywhere cost-with-tax is computed today (offer totals, our cost, quotation landed costs
   and margins, factory owed / factory payment plan, profit) — find every use of taxRate. Tests for both
   modes, and that old data (included=false, 13%) gives exactly the same numbers as before.
3. Settings: company default for new offers (included or not, %), defaulting to Without tax · 0%
   (Settings page section where other defaults live; zod schema in shared/schemas/settings.ts).
4. UI (apps/web/src/components/deals/offer-work.tsx and the offer form/panel):
   - Add/edit offer panel: a "Tax" box: "Their prices are" — two radio cards "Without tax · tax is added on
     top" / "Tax included · the price already has the tax in it"; "Tax %" input (default from settings, 0),
     hint "0 unless the factory charges tax, e.g. 13% VAT in China", note "Applies to every line; a line can
     still have its own %." Changing the offer % updates lines that had the old offer % (not lines the
     person set differently).
   - Offer details card: a "Tax" row: "0% · added on top" / "13% · included in the prices".
   - Lines: Tax % column stays; footer: without tax → "Factory total X without tax · Tax r% Y · Our cost
     Z"; included → "Factory total X tax included · of which tax r% Y · Our cost Z". Price column header
     "Price CNY" (no longer "without tax" wording when included); update hint texts that say "without tax".
   - Offers table: under the factory, a small "+13% tax" or "tax incl. 13%" when the rate isn't 0.
   - API DTOs/zod: accept taxIncluded + taxRate on the offer; audit records them.
5. Excel import/export of factory lines and the legacy importer (packages/database/scripts/import-legacy)
   keep working (old data = without tax, its rates).

Permissions as today (sourcing.manage). No AI/OCR. 390px fine.

## Done when
typecheck/lint/test/build green; screenshots (add offer panel with the Tax box, offer card + lines at 0%,
the same offer tax included at 13%, offers table, settings section) in /home/claude/shots/fix27-tax/; PR to
main; CI green.
