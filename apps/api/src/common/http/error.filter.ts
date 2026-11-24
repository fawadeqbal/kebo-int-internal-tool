import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError, z } from "zod";
import { ConflictError, DomainError, DuplicateError, ForbiddenError, GateError, NotFoundError, ReasonNeededError } from "@kebo/utils";
import { DB_ERROR, isDbError } from "@kebo/database";
import { fieldWords, isPlainError } from "@kebo/shared";

/**
 * One error shape for every client: { error, code?, fieldErrors? }.
 * Business errors carry messages written for people, so they pass through as they are;
 * anything unexpected is logged and shown as a generic message.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");
  /** Set by Dev tools (AppErrors): each unexpected error is also counted there. */
  static report?: (error: unknown, req: Request) => void;

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, body: Record<string, unknown>) => res.status(status).json(body);

    if (error instanceof ZodError) {
      // A plain message says which field it is about ("Amount: type a number."); a schema's own says it already.
      const first = error.issues[0];
      const key = first?.path.filter((x) => typeof x === "string").at(-1);
      const message = first ? (key && isPlainError(first.message) ? `${fieldWords(key)}: ${first.message.charAt(0).toLowerCase()}${first.message.slice(1)}` : first.message) : "Some details are not valid.";
      return send(422, { error: message, fieldErrors: z.flattenError(error).fieldErrors });
    }
    if (error instanceof DuplicateError) return send(409, { error: error.message, code: "duplicate", matches: error.matches });
    if (error instanceof ReasonNeededError) return send(409, { error: error.message, code: error.code, choices: error.choices });
    if (error instanceof GateError) return send(409, { error: error.message, code: error.code });
    if (error instanceof NotFoundError) return send(404, { error: error.message });
    if (error instanceof ForbiddenError) return send(403, { error: error.message, ...(error.code ? { code: error.code } : {}) });
    if (error instanceof ConflictError) return send(409, { error: error.message });
    if (error instanceof DomainError) return send(400, { error: error.message });
    if (isDbError(error, DB_ERROR.notFound)) return send(404, { error: "This record no longer exists. Reload and try again." });
    // A malformed id in a link ("/orders/not-an-id"): nothing has it, so the page is not found, not a server fault
    // (review 24 Nov, X-24: "Could not reach the server").
    if (isDbError(error, DB_ERROR.badValue) || (error instanceof Error && /invalid input syntax for type uuid|Error creating UUID/i.test(error.message)))
      return send(404, { error: "Nothing has this number. Check the link." });
    if (isDbError(error, DB_ERROR.uniqueViolation)) return send(409, { error: "That already exists (someone may have just saved it). Reload and try again." });
    // Another company's row (row-level security refused it): as if it did not exist.
    if (error instanceof Error && /row-level security/i.test(error.message)) return send(404, { error: "This record no longer exists. Reload and try again." });
    // Money dated in a closed month (the month close): expected, said plainly, not counted as an error.
    const closed = booksClosed(error);
    if (closed) return send(409, { error: closed, code: "books_closed" });
    // A database rule kept history as it was written (the ledger, the audit trail, stage moves, final papers).
    // The app never asks for that, so it is logged and counted like any surprise; the person reads why.
    const kept = keptAsWritten(error);
    if (kept) {
      this.log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      ErrorFilter.report?.(error, host.switchToHttp().getRequest<Request>());
      return send(409, { error: kept });
    }
    if (error instanceof HttpException) {
      const r = error.getResponse();
      const message = typeof r === "string" ? r : ((r as { message?: string | string[] }).message ?? error.message);
      // ParseUUIDPipe on a link's id ("/orders/not-an-id"): nothing has it (X-24, as above).
      if (error.getStatus() === 400 && /uuid is expected/i.test(String(message))) return send(404, { error: "Nothing has this number. Check the link." });
      const extra = typeof r === "object" && r ? (r as { code?: string; companies?: unknown }) : {};
      return send(error.getStatus(), {
        error: Array.isArray(message) ? message[0] : message,
        ...(extra.code ? { code: extra.code } : {}),
        ...(extra.companies ? { companies: extra.companies } : {}),
      });
    }
    this.log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    ErrorFilter.report?.(error, host.switchToHttp().getRequest<Request>());
    return send(500, { error: "Something went wrong. Please try again." });
  }
}

/** What the database rules that keep history as it was written say (migrations ledger and history_append_only). */
const KEPT = [
  "Ledger entries are never changed or deleted: post a correction instead",
  "History is never changed or deleted: it stays as it was written",
  "A final version stays as it was printed: make it again for a new version",
];

/** The month close's rule (migration month_close): its sentence, with the day the books are closed through. */
const BOOKS_CLOSED = /The books are closed through [^:]+: money dated then stays as it was reported\. Date it later, or reopen the month in Settings › Closed months/;

function keptAsWritten(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const said = KEPT.find((k) => message.includes(k));
  return said ? `${said}.` : null;
}

function booksClosed(error: unknown): string | null {
  const said = BOOKS_CLOSED.exec(error instanceof Error ? error.message : "")?.[0];
  return said ? `${said}.` : null;
}
