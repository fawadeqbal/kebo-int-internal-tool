/** GET /company/address */
export interface AddressView {
  canChange: boolean;
  slug: string;
  url: string;
  baseDomain: string | null;
  /** Not before this (the last change is recent). */
  nextChangeOn: string | null;
  check: { slug: string; url: string; problem: string | null } | null;
}
