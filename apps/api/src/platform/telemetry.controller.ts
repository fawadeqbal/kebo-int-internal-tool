import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Public } from "../common/auth/decorators";
import { tokenFrom } from "../common/auth/tokens.service";
import { CompanyContext } from "../common/company/company-context";
import { RateLimiter } from "../common/http/rate-limit";
import { Validate } from "../common/http/zod.pipe";
import { AppErrors, PAGE_PREFIX, RequestStats } from "./watch";

/** Reports per address and minute (a page with a loop of errors cannot flood the error list). */
const REPORTS_PER_MINUTE = 30;

const page = z.string().trim().min(1).max(300);
const telemetryInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("error"),
    page,
    name: z.string().trim().max(120).optional(),
    message: z.string().max(2000),
    stack: z.string().max(8000).optional(),
  }),
  /** How long the page took to show its main part (largest contentful paint), in ms. */
  z.object({ kind: z.literal("speed"), page, ms: z.number().min(0).max(120_000) }),
]);
type TelemetryInput = z.infer<typeof telemetryInput>;

/** "/orders/6f1e…/payment?x=1" → "/orders/[id]/payment": the page, never the ids in its address. */
export function pageRoute(path: string): string {
  const bare = path.split(/[?#]/)[0] || "/";
  const shaped = bare
    .split("/")
    .map((part) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) || /^\d{3,}$/.test(part) ? "[id]" : part))
    .join("/");
  return /^\/[A-Za-z0-9\-_./[\]]*$/.test(shaped) ? shaped.slice(0, 120) : "(other page)";
}

/**
 * What the browser saw, for Dev tools (Speed and errors): an error on a page (counted once per kind, like the
 * server's), and how fast a page showed. Sent by the web app itself (instrumentation-client.ts, WebVitals);
 * public, because the website's pages report too.
 */
@ApiTags("telemetry")
@Controller("telemetry")
export class TelemetryController {
  private readonly hits = new RateLimiter();

  constructor(
    private readonly errors: AppErrors,
    private readonly stats: RequestStats,
  ) {}

  @Public()
  @Post()
  @HttpCode(204)
  async report(@Req() req: Request, @Body(Validate(telemetryInput)) body: TelemetryInput) {
    if (!this.hits.allow(`t:${req.ip || req.socket.remoteAddress || "local"}`, REPORTS_PER_MINUTE, 60_000)) return;
    const where = pageRoute(body.page);
    if (body.kind === "speed") {
      this.stats.add(`${PAGE_PREFIX}${where}`, body.ms, false);
      return;
    }
    const error = new Error(body.message || "(no message)");
    error.name = body.name || "Error";
    error.stack = body.stack || `${error.name}: ${error.message}`;
    // The company only when someone signed in sent it (a visitor of the website is in none).
    const company = tokenFrom(req.headers) ? (CompanyContext.current()?.name ?? null) : null;
    await this.errors.record("web", where, error, { company, path: body.page.split(/[?#]/)[0]!.slice(0, 300) });
  }
}
