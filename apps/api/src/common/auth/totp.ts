import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Two-step sign-in with an authenticator app (RFC 6238 TOTP: 6 digits, 30 s,
 * SHA-1, the setting every app supports). The shared secret is stored
 * encrypted (AES-256-GCM, key derived from AUTH_SECRET), so a copy of the
 * database alone does not give anyone the codes.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), base32 as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Check a code, allowing one step of clock drift either way. Returns the step
 * it matched, which must be greater than the last step used (a code can't be
 * replayed), or null.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(digits))) return s;
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUrl(issuer: string, account: string, secret: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ----------------------------------------------------------- secret at rest */

/** Same derivation as the previous app, so secrets imported from it keep working with the same AUTH_SECRET. */
function key(authSecret: string) {
  return createHash("sha256").update(`totp-secret-v1:${authSecret}`).digest();
}

export function sealSecret(plain: string, authSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(authSecret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function openSecret(sealed: string, authSecret: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(authSecret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/* ----------------------------------------------------------- recovery codes */

const hashCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toLowerCase()).digest("hex");

/** Ten one-time codes like "k7qp-2mzx", for when the phone is lost. Only their hashes are stored. */
export function newRecoveryCodes(count = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}

/** If the code is one of the unused recovery codes, the remaining hashes; otherwise null. */
export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  const h = hashCode(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
