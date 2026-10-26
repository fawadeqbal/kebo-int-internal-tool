import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newRecoveryCodes, newTotpSecret, openSecret, sealSecret, totpAt, consumeRecoveryCode, verifyTotp } from "@/lib/auth/totp";

process.env.AUTH_SECRET ??= "test-secret-that-is-long-enough-for-the-check-0123";
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors (last 6 digits)", () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("round-trips base32", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("accepts ±1 step and refuses replays", () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    const code = totpAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", null, now)).toBeNull();
  });
  it("seals the secret", () => {
    const sealed = sealSecret("ABCDEF");
    expect(sealed).not.toContain("ABCDEF");
    expect(openSecret(sealed)).toBe("ABCDEF");
    expect(() => openSecret(sealed.slice(0, -2) + "xx")).toThrow();
  });
  it("uses each recovery code once", () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    const left = consumeRecoveryCode(hashes, codes[3].toUpperCase());
    expect(left).toHaveLength(9);
    expect(consumeRecoveryCode(left!, codes[3])).toBeNull();
  });
});
