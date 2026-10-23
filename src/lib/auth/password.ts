import bcrypt from "bcryptjs";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

let dummy: string | null = null;
/** A real hash used when the email is unknown, so timing does not reveal which emails exist. */
export function dummyHash(): string {
  if (!dummy) dummy = bcrypt.hashSync("not-a-real-password-placeholder", 12);
  return dummy;
}
