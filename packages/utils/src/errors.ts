/**
 * Business errors. Services throw these; the API turns them into HTTP responses
 * (400 / 403 / 404 / 409) and the web shows the message as it is, so every
 * message is written for the person using the app.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(public readonly entity = "Record") {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The action clashes with the current state (e.g. it was changed by someone else, or already done). */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Looks like something that already exists; `matches` lets the UI offer the existing record instead. */
export class DuplicateError extends ConflictError {
  constructor(
    message: string,
    public readonly matches: { id: string; label: string; detail?: string }[],
  ) {
    super(message);
    this.name = "DuplicateError";
  }
}

/** A business rule says no until something else is done first; `code` lets the UI offer the fix. */
export class GateError extends DomainError {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GateError";
  }
}

