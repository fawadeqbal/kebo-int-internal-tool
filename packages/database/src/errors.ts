import { Prisma } from "./generated/prisma/client";

/** Prisma error codes the app reacts to. */
export const DB_ERROR = {
  /** A unique value is already taken. */
  uniqueViolation: "P2002",
  /** The record to update or delete does not exist. */
  notFound: "P2025",
} as const;

/** Whether an error is a known Prisma error with this code (keeps Prisma's classes inside this package). */
export function isDbError(error: unknown, code: (typeof DB_ERROR)[keyof typeof DB_ERROR]): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
