import { expect, type Page } from "@playwright/test";

/**
 * A new order of its own (no other test touches it): a customer with a contact, an inquiry, a supplier's offer,
 * the quotation sent and accepted, paid by LC and booked by sea. Its quotation (accepted) is final, so it can be
 * emailed and shared.
 */
export async function newOrder(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (method: "post" | "put" | "patch", url: string, data: object) => {
    const r = await page.request[method](`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("post", "/customers", {
    name: `Vision Pharma ${tag}`,
    country: "PK",
    address: "Plot No. 22-23, Industrial Triangle, Kahuta Road, Islamabad",
    taxNo: "8890224-6",
    contacts: [{ name: "Ali", email: `ali-${tag}@vision.test` }],
  });
  const inquiry = await send("post", "/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items: [{ description: "Vial capping machine RHZ-8", quantity: 1, unit: "set" }] });
  const item = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).items[0].id;
  await send("post", `/inquiries/${inquiry.id}/factory-quotes`, {
    newSupplierName: `Jining Capping ${tag}`,
    receivedOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [{ requestedItemId: item, description: "Vial capping machine RHZ-8", quantity: 1, unit: "set", unitPrice: 200000 }],
  });
  const draft = await (await page.request.get(`/api/inquiries/${inquiry.id}/quotation/draft`)).json();
  const rev = await send("post", `/inquiries/${inquiry.id}/quotation/revisions`, draft);
  await send("post", `/revisions/${rev.id}/status`, { to: "sent" });
  await send("post", `/revisions/${rev.id}/status`, { to: "accepted" });
  const id = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).orders[0].id as string;
  await send("patch", `/orders/${id}/route`, { route: "letter_of_credit" });
  await send("post", `/orders/${id}/shipments`, { mode: "sea", status: "booked", portOfLoading: "Qingdao, China", portOfDischarge: "Karachi Port, Pakistan" });
  return id;
}
