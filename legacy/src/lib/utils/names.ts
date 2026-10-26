/** How a customer is shown: company name, or the contact person when there is no company. */
export const customerName = (c: { companyName: string | null; contactPerson: string }) => c.companyName || c.contactPerson;
