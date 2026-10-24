import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * Backup encryption for the off-site copy: AES-256-GCM with a key derived
 * from BACKUP_ENCRYPTION_KEY (scrypt, random salt per file).
 * File layout: "KBK1" | salt (16) | iv (12) | ciphertext | auth tag (16).
 * Without the key the copy is unreadable, and any change to it is detected.
 */
const MAGIC = Buffer.from("KBK1");
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;

const deriveKey = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function checkPassphrase(passphrase: string | undefined): string {
  if (!passphrase || passphrase.length < 20) throw new Error("BACKUP_ENCRYPTION_KEY must be at least 20 characters (use: openssl rand -base64 32)");
  return passphrase;
}

export async function encryptFile(src: string, dest: string, passphrase: string) {
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(checkPassphrase(passphrase), salt), iv);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function decryptFile(src: string, dest: string, passphrase: string) {
  const { size } = await fs.stat(src);
  if (size < HEADER + TAG) throw new Error("Not an encrypted backup (too small)");
  const handle = await fs.open(src, "r");
  try {
    const head = Buffer.alloc(HEADER);
    await handle.read(head, 0, HEADER, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted Kebo backup");
    const tag = Buffer.alloc(TAG);
    await handle.read(tag, 0, TAG, size - TAG);
    const salt = head.subarray(MAGIC.length, MAGIC.length + SALT);
    const iv = head.subarray(MAGIC.length + SALT, HEADER);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(checkPassphrase(passphrase), salt), iv);
    decipher.setAuthTag(tag);
    await pipeline(createReadStream(src, { start: HEADER, end: size - TAG - 1 }), decipher, createWriteStream(dest, { mode: 0o600 }));
  } finally {
    await handle.close();
  }
}
