/**
 * Where a change needs a reason, and the quick choices offered for it. New
 * records and drafts never ask; changing something already used, sent or paid
 * does (see docs: "Reasons for edits"). People may also write their own words.
 */
export const REASON_CHOICES = {
  items: ["Customer changed the quantity", "Factory split it into parts", "Factory's minimum order", "Factory doesn't make this", "Mistake fixed"],
  split: ["Factory quotes it in parts", "Customer asked for the parts separately", "Easier to compare factories"],
  customer: ["Wrong customer was chosen", "Customer's other company is buying"],
  reassign: ["Workload", "Person is away", "Better fit for this product"],
  hold: ["Customer is deciding", "Waiting for the factory", "Waiting for documents"],
  reopen: ["Customer came back", "Marked lost by mistake"],
  factoryPrice: ["Factory changed its price", "Factory changed its terms", "Mistake fixed"],
  factoryChoice: ["Cheaper factory", "Better quality", "Faster delivery", "Factory can't make it"],
  newRevision: ["Customer asked for a discount", "Quantities changed", "Factory price changed", "Terms changed"],
  quoteAnswer: ["Price too high", "Customer bought elsewhere", "No reply from the customer", "Project cancelled"],
  orderBack: ["Moved forward by mistake", "Goods not ready after all", "Customer claim"],
  shipping: ["Ship date was wrong", "B/L number corrected", "Shipped on another vessel"],
  closeWithDue: ["Customer pays with the next order", "Agreed discount", "Written off"],
  customerDetails: ["Company renamed", "Spelling fixed", "Wrong country"],
  factoryDetails: ["Factory renamed", "Spelling fixed", "Another person handles this factory"],
  settings: ["New exchange rate", "New company policy", "Mistake fixed"],
} as const satisfies Record<string, readonly string[]>;

export type ReasonKind = keyof typeof REASON_CHOICES;
