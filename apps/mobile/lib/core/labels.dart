import '../theme/colors.dart';

/// The words people see and the badge tones, the same as the web (packages/shared/src/labels.ts).

const roleLabel = {'admin': 'Super Admin', 'manager': 'Manager', 'staff': 'Staff'};

/* ---------------------------------------------------------------- deals */

const stageLabel = {'new': 'New', 'sourcing': 'Sourcing', 'quoted': 'Quoted', 'won': 'Won', 'lost': 'Lost'};

/// One line under each stage: whose turn it is.
const stageHint = {
  'new': 'Nobody has started yet',
  'sourcing': 'We are getting factory prices',
  'quoted': 'Waiting for the customer',
  'won': 'Order confirmed',
  'lost': 'Closed without an order',
};

const stageTone = {'new': Tone.warn, 'sourcing': Tone.info, 'quoted': Tone.info, 'won': Tone.ok, 'lost': Tone.neutral};

const openStages = {'new', 'sourcing', 'quoted'};

const channelLabel = {
  'website': 'Website form',
  'whatsapp': 'WhatsApp',
  'wechat': 'WeChat',
  'email': 'Email',
  'phone': 'Phone',
  'visit': 'Visit / trade fair',
  'other': 'Other',
};

const priorityLabel = {'low': 'Low', 'normal': 'Normal', 'high': 'High', 'urgent': 'Urgent'};
const priorityTone = {'low': Tone.outline, 'normal': Tone.neutral, 'high': Tone.warn, 'urgent': Tone.bad};

const lostReasonLabel = {
  'price_too_high': 'Price too high',
  'no_reply': 'No reply from customer',
  'factory_cannot_supply': "Factory can't make it or meet the date",
  'bought_elsewhere': 'Customer bought elsewhere',
  'customer_cancelled': 'Customer cancelled',
  'duplicate_or_spam': 'Duplicate or spam',
  'other': 'Other',
};

/// Why a stage changed (stage history `cause`).
const stageCauseLabel = {
  'created': 'Deal created',
  'assigned': 'Someone was assigned',
  'factory_price_added': 'Factory price added',
  'quotation_sent': 'Quotation sent',
  'quotation_accepted': 'Customer accepted the quotation',
  'order_cancelled': 'Order cancelled',
  'manual': '',
};

/* ---------------------------------------------------------------- customers */

/// "ZZ" means not known yet (e.g. a website inquiry): the screens ask for it.
const unknownCountry = 'ZZ';

const customerTypeLabel = {'company': 'Company', 'individual': 'Individual'};
const taxTreatmentLabel = {'export_zero_rated': 'Export (no VAT)', 'domestic_vat': 'Domestic (VAT)'};

/* ---------------------------------------------------------------- quotations */

const revisionStatusLabel = {
  'draft': 'Draft',
  'sent': 'Sent',
  'accepted': 'Accepted',
  'rejected': 'Rejected',
  'expired': 'Expired',
  'superseded': 'Replaced by a newer revision',
  'void': 'Order cancelled',
};

const revisionStatusTone = {
  'draft': Tone.neutral,
  'sent': Tone.info,
  'accepted': Tone.ok,
  'rejected': Tone.bad,
  'expired': Tone.warn,
  'superseded': Tone.outline,
  'void': Tone.neutral,
};

const lineTypeLabel = {'goods': 'Goods', 'service': 'Service', 'charge': 'Charge (freight, fees)'};

const balanceTermsLabel = {
  'before_shipment': 'Balance before shipment',
  'against_bl_copy': 'Balance against B/L copy',
  'after_arrival': 'Balance after arrival',
  'letter_of_credit': 'Letter of credit',
};

/* ---------------------------------------------------------------- orders */

const orderStageLabel = {
  'awaiting_deposit': 'Awaiting deposit',
  'in_production': 'In production',
  'ready_to_ship': 'Ready to ship',
  'shipped': 'Shipped',
  'closed': 'Closed',
  'cancelled': 'Cancelled',
};

const orderStageTone = {
  'awaiting_deposit': Tone.warn,
  'in_production': Tone.info,
  'ready_to_ship': Tone.info,
  'shipped': Tone.info,
  'closed': Tone.ok,
  'cancelled': Tone.neutral,
};

const teamLabel = {'sales': 'Sales', 'sourcing': 'Sourcing', 'accounts': 'Accounts', 'logistics': 'Logistics'};

/// Headlines for a step the server refused (the server's own message is shown under it).
const gateTitle = {
  'deposit_first': "The customer's deposit comes first",
  'inspect_first': 'Inspection comes first',
  'balance_first': 'The balance comes first',
  'note_required': 'Say why',
  'required_step': "This step can't be skipped",
  'dependents_done': 'A later step depends on this one',
  'future_date': 'Not a future date',
  'order_not_open': 'This order is closed',
  'already_done': 'Already done',
  'not_done': 'Still to do',
};

const factoryOrderStatusLabel = {'draft': 'Draft', 'sent': 'Sent to factory', 'confirmed': 'Confirmed by factory', 'cancelled': 'Cancelled'};
const factoryOrderStatusTone = {'draft': Tone.neutral, 'sent': Tone.info, 'confirmed': Tone.ok, 'cancelled': Tone.outline};

const paymentKindLabel = {'deposit': 'Deposit', 'balance': 'Balance', 'other': 'Other'};

const paymentMethodLabel = {
  'bank_transfer': 'Bank transfer (T/T)',
  'letter_of_credit': 'Letter of credit (L/C)',
  'cash': 'Cash',
  'cheque': 'Cheque',
  'online': 'Online payment',
  'other': 'Other',
};

/// The customer's payment position on an order.
const customerPaymentLabel = {'unpaid': 'Nothing received', 'deposit_paid': 'Deposit received', 'partly_paid': 'Partly paid', 'paid': 'Paid in full', 'overpaid': 'Overpaid'};

const invoiceTypeLabel = {'proforma': 'Proforma invoice', 'commercial': 'Commercial invoice'};
const invoiceStatusLabel = {'draft': 'Draft', 'issued': 'Issued', 'void': 'Void'};
const invoiceStatusTone = {'draft': Tone.neutral, 'issued': Tone.ok, 'void': Tone.outline};

const shipmentStatusLabel = {'planned': 'Planned', 'booked': 'Booked', 'departed': 'Departed', 'arrived': 'Arrived'};
const shipmentStatusTone = {'planned': Tone.neutral, 'booked': Tone.info, 'departed': Tone.info, 'arrived': Tone.ok};

/// Common countries for the customer form (ISO codes); any other code can be typed.
const countryNames = {
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'QA': 'Qatar',
  'OM': 'Oman',
  'KW': 'Kuwait',
  'BH': 'Bahrain',
  'PK': 'Pakistan',
  'IN': 'India',
  'BD': 'Bangladesh',
  'NG': 'Nigeria',
  'GH': 'Ghana',
  'KE': 'Kenya',
  'TZ': 'Tanzania',
  'ET': 'Ethiopia',
  'EG': 'Egypt',
  'ZA': 'South Africa',
  'IQ': 'Iraq',
  'TR': 'Türkiye',
  'RU': 'Russia',
  'KZ': 'Kazakhstan',
  'UZ': 'Uzbekistan',
  'ID': 'Indonesia',
  'MY': 'Malaysia',
  'VN': 'Vietnam',
  'TH': 'Thailand',
  'PH': 'Philippines',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'US': 'United States',
  'GB': 'United Kingdom',
  'DE': 'Germany',
  'CN': 'China',
};

String countryName(String code) => code == unknownCountry ? 'Country not known yet' : countryNames[code] ?? code;
