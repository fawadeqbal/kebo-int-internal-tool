/** GET /company/website-form */
export interface WebsiteFormView {
  key: string;
  /** Where the form posts. */
  endpoint: string;
  /** The plan includes the website form. */
  allowed: boolean;
}
