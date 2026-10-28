/** Customers and factories to and from Excel: the templates, and the rows of a filled file checked as the forms check them. */

import { CURRENCIES, customerInput, factoryInput, UNKNOWN_COUNTRY, type CustomerInput, type FactoryInput } from "@kebo/shared";
import { COUNTRIES } from "@/lib/countries";
import { headerKey, type ReadSheet, type SheetCol, type SheetSpec } from "@/lib/sheet-spec";

type Field = { key: string; header: string; names: string[]; col: Omit<SheetCol, "header"> };

const CUSTOMER_FIELDS: Field[] = [
  { key: "name", header: "Customer name", names: ["customer", "company", "companyname", "customername", "buyer", "client"], col: { width: 32, required: true, note: "rows with the same name are one customer with several contacts" } },
  { key: "type", header: "Type", names: ["type", "customertype"], col: { width: 12, choices: ["Company", "Individual"], strict: true, note: "empty: company" } },
  { key: "country", header: "Country", names: ["country", "countrycode"], col: { width: 18, choices: COUNTRIES.map(([, n]) => n), note: "a name from the list or a 2-letter code (NG, AE); empty: not known yet" } },
  { key: "defaultCurrency", header: "Currency", names: ["currency", "defaultcurrency"], col: { width: 10, choices: [...CURRENCIES], note: "empty: USD" } },
  { key: "address", header: "Address", names: ["address", "companyaddress"], col: { width: 36 } },
  { key: "taxNo", header: "Tax no.", names: ["taxno", "tax", "vat", "vatno", "tin", "taxid"], col: { width: 16 } },
  { key: "regNo", header: "Registration no.", names: ["registrationno", "regno", "crno", "cr", "registration"], col: { width: 16 } },
  { key: "initials", header: "Letters on documents", names: ["lettersondocuments", "initials", "letters"], col: { width: 10, note: "1 to 6 letters for proforma numbers, e.g. TN; empty: from the name" } },
  { key: "notes", header: "Notes", names: ["notes", "note", "remarks", "comments"], col: { width: 30 } },
  { key: "contact.name", header: "Contact name", names: ["contact", "contactname", "contactperson", "person", "attn"], col: { width: 22, required: true } },
  { key: "contact.position", header: "Position", names: ["position", "title", "jobtitle", "designation", "role"], col: { width: 16 } },
  { key: "contact.email", header: "Email", names: ["email", "emailaddress", "mail", "email1"], col: { width: 26, note: "each contact needs an email, phone, WhatsApp or WeChat" } },
  { key: "contact.phone", header: "Phone", names: ["phone", "tel", "telephone", "mobile", "phoneno", "cell"], col: { width: 18 } },
  { key: "contact.whatsapp", header: "WhatsApp", names: ["whatsapp", "wa", "whatsappno"], col: { width: 18 } },
  { key: "contact.wechat", header: "WeChat", names: ["wechat", "wechatid", "weixin"], col: { width: 16 } },
];

const FACTORY_FIELDS: Field[] = [
  { key: "name", header: "Factory name", names: ["factory", "factoryname", "supplier", "suppliername", "company", "companyname", "name", "vendor"], col: { width: 32, required: true } },
  { key: "contactPerson", header: "Contact person", names: ["contact", "contactperson", "contactname", "person"], col: { width: 22 } },
  { key: "phone", header: "Phone", names: ["phone", "tel", "telephone", "mobile", "cell"], col: { width: 18 } },
  { key: "email", header: "Email", names: ["email", "mail", "emailaddress"], col: { width: 26 } },
  { key: "wechat", header: "WeChat", names: ["wechat", "wechatid", "weixin"], col: { width: 16 } },
  { key: "address", header: "Address", names: ["address", "factoryaddress", "location"], col: { width: 36 } },
  { key: "bankDetails", header: "Bank details", names: ["bankdetails", "bank", "bankaccount", "account"], col: { width: 36 } },
  { key: "notes", header: "Notes", names: ["notes", "note", "remarks", "products", "comments"], col: { width: 30 } },
];

function template(name: string, fields: Field[], help: string[]): SheetSpec {
  return {
    name: `${name} - template`,
    title: name,
    columns: fields.map((f) => ({ header: f.header, ...f.col })),
    rows: [],
    template: { help },
  };
}

export const customersTemplate = () =>
  template("Customers", CUSTOMER_FIELDS, [
    "Customers: one row per contact.",
    "A customer with two contacts takes two rows with the same Customer name; the customer's details are read from its first row.",
    "Upload the file with Excel › Upload a filled file. The customers are shown to check; nothing is saved until you add them.",
    "Only new customers are added: one already here (same name, or a contact's email or phone already known) is left out.",
  ]);

export const factoriesTemplate = () =>
  template("Factories", FACTORY_FIELDS, [
    "Factories: one row per factory.",
    "Upload the file with Excel › Upload a filled file. The factories are shown to check; nothing is saved until you add them.",
    "Only new factories are added: a name already here is left out.",
  ]);

/** Each field's column in the file (by the template's heading, or a usual other name). */
function columnsOf(headers: string[], fields: Field[]) {
  const keys = headers.map(headerKey);
  const at = new Map<string, number>();
  for (const f of fields) {
    const i = keys.findIndex((k, n) => !!k && [...at.values()].every((u) => u !== n) && (k === headerKey(f.header) || f.names.includes(k)));
    if (i >= 0) at.set(f.key, i);
  }
  const unused = headers.filter((h, i) => h.trim() && ![...at.values()].includes(i));
  return { at, unused };
}

const COUNTRY_BY_NAME = new Map(COUNTRIES.map(([c, n]) => [n.toLowerCase(), c]));
const countryOf = (t: string) => {
  const v = t.trim();
  if (!v) return UNKNOWN_COUNTRY;
  return COUNTRY_BY_NAME.get(v.toLowerCase()) ?? v; // a 2-letter code, or left for the check to point out
};

/** One customer or factory read from a file, checked as the form checks it. */
export interface PartyRow<T> {
  name: string;
  /** "Nigeria · 2 contacts" */
  detail: string;
  /** Its rows in the file (the heading is row 1). */
  rows: number[];
  input: T | null;
  problem: string | null;
}

export interface PartyRead<T> {
  items: PartyRow<T>[];
  unused: string[];
  error: string | null;
}

/** The first message of a failed check, with where it is ("Contact 2: Give at least one way to reach…"). */
function firstIssue(issues: { path: PropertyKey[]; message: string }[]) {
  const i = issues[0]!;
  return i.path[0] === "contacts" && typeof i.path[1] === "number" ? `Contact ${i.path[1] + 1}: ${i.message}` : i.message;
}

export function customersFromSheet(read: ReadSheet): PartyRead<CustomerInput> {
  const { at, unused } = columnsOf(read.headers, CUSTOMER_FIELDS);
  if (!at.has("name")) return { items: [], unused, error: "No “Customer name” column in the file. Download the template from Excel › Download a template, or rename the column." };
  const cell = (cells: string[], key: string) => (at.has(key) ? (cells[at.get(key)!] ?? "").trim() : "");
  const groups = new Map<string, { rows: number[]; cells: string[][] }>();
  read.rows.forEach((cells, r) => {
    const name = cell(cells, "name");
    if (!name) {
      if (cells.some((c) => c.trim())) groups.set(`\u0000${r}`, { rows: [r + 2], cells: [cells] }); // a contact without a customer: shown as a problem
      return;
    }
    const g = groups.get(name.toLowerCase()) ?? { rows: [], cells: [] };
    g.rows.push(r + 2);
    g.cells.push(cells);
    groups.set(name.toLowerCase(), g);
  });
  const items: PartyRow<CustomerInput>[] = [...groups.values()].map((g) => {
    const first = g.cells[0]!;
    const name = cell(first, "name");
    if (!name) return { name: "(no customer name)", detail: "", rows: g.rows, input: null, problem: "Enter the customer's name" };
    const type = cell(first, "type").toLowerCase();
    const raw = {
      name,
      type: type.startsWith("ind") || type === "person" ? "individual" : "company",
      country: countryOf(cell(first, "country")),
      defaultCurrency: cell(first, "defaultCurrency").toUpperCase() || undefined,
      address: cell(first, "address"),
      taxNo: cell(first, "taxNo"),
      regNo: cell(first, "regNo"),
      initials: cell(first, "initials"),
      notes: cell(first, "notes"),
      contacts: g.cells
        .map((c) => ({
          name: cell(c, "contact.name"),
          position: cell(c, "contact.position"),
          email: cell(c, "contact.email"),
          phone: cell(c, "contact.phone"),
          whatsapp: cell(c, "contact.whatsapp"),
          wechat: cell(c, "contact.wechat"),
        }))
        .filter((c) => Object.values(c).some(Boolean)),
    };
    const parsed = customerInput.safeParse(raw);
    const contacts = raw.contacts.length;
    const detail = `${parsed.success && parsed.data.country !== UNKNOWN_COUNTRY ? (COUNTRIES.find(([c]) => c === parsed.data.country)?.[1] ?? parsed.data.country) : raw.country === UNKNOWN_COUNTRY ? "country not known yet" : raw.country} · ${contacts} contact${contacts === 1 ? "" : "s"}`;
    return parsed.success
      ? { name, detail, rows: g.rows, input: parsed.data, problem: null }
      : { name, detail, rows: g.rows, input: null, problem: firstIssue(parsed.error.issues) };
  });
  if (!items.length) return { items, unused, error: "The file has headings but no customers." };
  return { items, unused, error: null };
}

export function factoriesFromSheet(read: ReadSheet): PartyRead<FactoryInput> {
  const { at, unused } = columnsOf(read.headers, FACTORY_FIELDS);
  if (!at.has("name")) return { items: [], unused, error: "No “Factory name” column in the file. Download the template from Excel › Download a template, or rename the column." };
  const cell = (cells: string[], key: string) => (at.has(key) ? (cells[at.get(key)!] ?? "").trim() : "");
  const seen = new Set<string>();
  const items: PartyRow<FactoryInput>[] = [];
  read.rows.forEach((cells, r) => {
    if (!cells.some((c) => c.trim())) return;
    const raw = Object.fromEntries(FACTORY_FIELDS.map((f) => [f.key, cell(cells, f.key)]));
    const name = raw.name ?? "";
    const detail = [raw.contactPerson, raw.phone || raw.email || raw.wechat].filter(Boolean).join(" · ");
    if (name && seen.has(name.toLowerCase())) {
      items.push({ name, detail, rows: [r + 2], input: null, problem: "This name is already higher up in the file" });
      return;
    }
    seen.add(name.toLowerCase());
    const parsed = factoryInput.safeParse(raw);
    items.push(
      parsed.success
        ? { name, detail, rows: [r + 2], input: parsed.data, problem: null }
        : { name: name || "(no factory name)", detail, rows: [r + 2], input: null, problem: firstIssue(parsed.error.issues) },
    );
  });
  if (!items.length) return { items, unused, error: "The file has headings but no factories." };
  return { items, unused, error: null };
}
