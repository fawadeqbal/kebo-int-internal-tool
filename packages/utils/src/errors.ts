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
  /** `code` lets the UI offer the way in (e.g. "two_step_setup": set up two-step sign-in first). */
  constructor(
    message = "You do not have permission to do this.",
    public readonly code?: string,
  ) {
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

/**
 * The change affects someone else, the customer, a factory or money, so it needs
 * a reason. Answered 409 { code: "reason_needed", choices }; the form asks "Why?"
 * (quick choices or own words) and sends the same request again with `reason`.
 */
export class ReasonNeededError extends GateError {
  constructor(
    message: string,
    public readonly choices: readonly string[],
  ) {
    super(message, "reason_needed");
    this.name = "ReasonNeededError";
  }
}

