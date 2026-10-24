import { apiUser, handle, json } from "@/lib/api/http";
import { can } from "@/lib/auth/permissions";
import { priorityEnum, querySourceEnum } from "@/lib/db/schema";
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, PRIORITY_LABEL, QUERY_STATUS_LABEL, QUOTATION_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { PACKAGE_TYPES, UNITS } from "@/lib/packing";
import { TRANSITIONS } from "@/modules/queries/workflow";
import { QUOTATION_TRANSITIONS } from "@/modules/quotations/workflow";
import { listCategoriesInUse, mergeCategories } from "@/modules/queries/repository";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { PRESETS } from "@/modules/reports/range";

export const runtime = "nodejs";

/** Everything the app needs to build its forms: labels, categories, people, defaults, company. */
export const GET = handle(async () => {
  const user = await apiUser();
  const [settings, people, used] = await Promise.all([getSettings(), listActiveUsers(), listCategoriesInUse()]);
  const categories = mergeCategories(settings.categories, used);
  return json({
    company: {
      name: settings.companyName,
      address: settings.companyAddress,
      phone: settings.companyPhone,
      email: settings.companyEmail,
      website: settings.companyWebsite,
      taxNo: settings.companyTaxNo,
      bankDetails: settings.bankDetails,
    },
    currency: settings.currency,
    defaults: {
      taxRate: settings.defaultTaxRate,
      quotationValidityDays: settings.quotationValidityDays,
      invoicePaymentDays: settings.invoicePaymentDays,
      quotationTerms: settings.defaultQuotationTerms,
    },
    // Costing (only for people who see factory prices).
    costing: can(user.role, "sourcing.manage") ? { exchangeRates: settings.exchangeRates, defaultMarginPercent: settings.defaultMarginPercent } : null,
    categories: { configured: settings.categories, all: categories },
    people: can(user.role, "queries.assign") || can(user.role, "queries.viewAll") ? people : people.filter((p) => p.id === user.id),
    labels: {
      queryStatus: QUERY_STATUS_LABEL,
      quotationStatus: QUOTATION_STATUS_LABEL,
      invoiceStatus: INVOICE_STATUS_LABEL,
      source: SOURCE_LABEL,
      priority: PRIORITY_LABEL,
      paymentMethod: PAYMENT_METHOD_LABEL,
    },
    order: { source: querySourceEnum.enumValues, priority: priorityEnum.enumValues },
    transitions: { query: TRANSITIONS, quotation: QUOTATION_TRANSITIONS },
    packing: { packageTypes: PACKAGE_TYPES, units: UNITS },
    reportRanges: PRESETS,
  });
});
