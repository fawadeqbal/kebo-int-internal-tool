import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodError, z } from "zod";
import { ConflictError, DomainError, DuplicateError, ForbiddenError, GateError, NotFoundError, ReasonNeededError } from "@kebo/utils";
import { DB_ERROR, isDbError } from "@kebo/database";

/**
 * One error shape for every client: { error, code?, fieldErrors? }.
 * Business errors carry messages written for people, so they pass through as they are;
 * anything unexpected is logged and shown as a generic message.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, body: Record<string, unknown>) => res.status(status).json(body);

    if (error instanceof ZodError) {
      return send(422, { error: error.issues[0]?.message ?? "Some details are not valid.", fieldErrors: z.flattenError(error).fieldErrors });
    }
    if (error instanceof DuplicateError) return send(409, { error: error.message, code: "duplicate", matches: error.matches });
    if (error instanceof ReasonNeededError) return send(409, { error: error.message, code: error.code, choices: error.choices });
    if (error instanceof GateError) return send(409, { error: error.message, code: error.code });
    if (error instanceof NotFoundError) return send(404, { error: error.message });
    if (error instanceof ForbiddenError) return send(403, { error: error.message, ...(error.code ? { code: error.code } : {}) });
    if (error instanceof ConflictError) return send(409, { error: error.message });
    if (error instanceof DomainError) return send(400, { error: error.message });
    if (isDbError(error, DB_ERROR.notFound)) return send(404, { error: "This record no longer exists. Reload and try again." });
    if (isDbError(error, DB_ERROR.uniqueViolation)) return send(409, { error: "That already exists (someone may have just saved it). Reload and try again." });
    if (error instanceof HttpException) {
      const r = error.getResponse();
      const message = typeof r === "string" ? r : ((r as { message?: string | string[] }).message ?? error.message);
      return send(error.getStatus(), { error: Array.isArray(message) ? message[0] : message });
    }
    this.log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return send(500, { error: "Something went wrong. Please try again." });
  }
}
