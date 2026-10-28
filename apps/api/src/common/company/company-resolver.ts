import { Injectable } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TokensService, tokenFrom } from "../auth/tokens.service";
import { CompaniesService } from "./companies.service";
import { CompanyContext, type CompanyInfo } from "./company-context";

/** The header the web app (and later the address) uses to say which company a signed-out request is for. */
export const COMPANY_HEADER = "x-company";

/**
 * Decides which company each request works in, before anything else runs:
 * - a session token: the company it was issued in (tokens from before companies: the first company);
 * - otherwise the X-Company header or ?company= (a company's short name);
 * - otherwise the default company.
 * Platform routes (/api/platform/…) work in no company.
 */
@Injectable()
export class CompanyResolver {
  constructor(
    private readonly companies: CompaniesService,
    private readonly tokens: TokensService,
  ) {}

  async resolve(req: Request): Promise<CompanyInfo | null> {
    const path = req.originalUrl ?? req.url;
    if (/^\/api\/platform(\/|$|\?)/.test(path)) return null;
    const token = tokenFrom(req.headers);
    const claims = token ? await this.tokens.verify(token) : null;
    if (claims) {
      if (!claims.companyId) return this.companies.defaultCompany();
      return this.companies.byId(claims.companyId);
    }
    const named = req.headers[COMPANY_HEADER] ?? (req.query as Record<string, unknown> | undefined)?.company;
    if (typeof named === "string" && named.trim()) return this.companies.bySlug(named);
    return this.companies.defaultCompany();
  }

  /** Express middleware: runs the rest of the request inside its company. */
  middleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
      this.resolve(req).then(
        (company) => CompanyContext.run(company, next),
        (e) => next(e),
      );
    };
  }
}
