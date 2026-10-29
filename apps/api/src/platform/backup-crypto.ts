import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { DomainError } from "@kebo/utils";

/**
 * The encryption of a company backup (.kebo-backup): the whole file is locked
 * with a password the person chooses. node:crypto only.
 *
 * File = header (plain, 50 bytes) + chunks.
 *  header: "KEBOBAK\0", format 1, kdf 1 (scrypt), log2 N, r, p, 0, chunk size (uint32 BE),
 *          salt (16), password check (16).
 *  key:    scrypt(password, salt) → 48 bytes: the AES-256 key, and the check (so a wrong
 *          password is told apart from a damaged file, before anything is read).
 *  chunk:  AES-256-GCM of up to `chunk size` bytes, then its 16-byte tag. The nonce is the
 *          chunk's number; the authenticated data is the header, the number and whether it is
 *          the last chunk. So a changed byte, chunks swapped or dropped, or a file cut short
 *          (the last chunk is missing its "last" mark) all fail. Every chunk but the last is
 *          full; the last is shorter (empty when the data ends on a chunk boundary).
 */

const MAGIC = Buffer.from("KEBOBAK\0", "latin1");
export const BACKUP_HEADER_BYTES = 50;
const TAG = 16;
const FORMAT = 1;
const KDF_SCRYPT = 1;
/** scrypt N = 2^17, r = 8, p = 1 (OWASP's minimum): 128 MB and about half a second. */
export const DEFAULT_COST = { log2N: 17, r: 8, p: 1 } as const;
export const DEFAULT_CHUNK = 1024 * 1024;
export const MIN_PASSWORD = 12;

/** Why a backup file cannot be used (shown to the person as it is). */
export class BackupFileError extends DomainError {
  constructor(
    message: string,
    public readonly reason: "not_backup" | "newer" | "password" | "damaged" | "incomplete",
  ) {
    super(message);
    this.name = "BackupFileError";
  }
}

export const backupErrors = {
  notBackup: () => new BackupFileError("This is not an RFQ Desk backup file (.kebo-backup).", "not_backup"),
  newer: () => new BackupFileError("This backup was made by a newer version of RFQ Desk. Update the app first.", "newer"),
  password: () => new BackupFileError("The password is not right for this backup.", "password"),
  damaged: () => new BackupFileError("The backup file is damaged or was changed. It cannot be used.", "damaged"),
  incomplete: () => new BackupFileError("The backup file is incomplete (cut off). It cannot be used.", "incomplete"),
};

export interface Cost {
  log2N: number;
  r: number;
  p: number;
}

/** One key derivation at a time in this process (each takes 128 MB for half a second). */
let queue: Promise<unknown> = Promise.resolve();
function derive(password: string, salt: Buffer, cost: Cost): Promise<Buffer> {
  const N = 2 ** cost.log2N;
  const opts: ScryptOptions = { N, r: cost.r, p: cost.p, maxmem: 128 * N * cost.r * cost.p * 2 + 1024 * 1024 };
  const run = () =>
    new Promise<Buffer>((resolve, reject) =>
      scryptCb(password.normalize("NFKC"), salt, 48, opts, (err, key) => (err ? reject(err) : resolve(key))),
    );
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function header(cost: Cost, chunk: number, salt: Buffer, check: Buffer) {
  const h = Buffer.alloc(BACKUP_HEADER_BYTES);
  MAGIC.copy(h, 0);
  h[8] = FORMAT;
  h[9] = KDF_SCRYPT;
  h[10] = cost.log2N;
  h[11] = cost.r;
  h[12] = cost.p;
  h[13] = 0;
  h.writeUInt32BE(chunk, 14);
  salt.copy(h, 18);
  check.copy(h, 34);
  return h;
}

const nonceOf = (index: number) => {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(BigInt(index), 4);
  return n;
};
const aadOf = (head: Buffer, index: number, last: boolean) => {
  const a = Buffer.alloc(head.length + 9);
  head.copy(a, 0);
  a.writeBigUInt64BE(BigInt(index), head.length);
  a[head.length + 8] = last ? 1 : 0;
  return a;
};

/** Collects incoming buffers; takes exact amounts off the front. */
class Bytes {
  private parts: Buffer[] = [];
  length = 0;
  push(b: Buffer) {
    if (b.length) this.parts.push(b), (this.length += b.length);
  }
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const p = this.parts[0]!;
      const use = Math.min(p.length, n - at);
      p.copy(out, at, 0, use);
      at += use;
      if (use === p.length) this.parts.shift();
      else this.parts[0] = p.subarray(use);
    }
    this.length -= n;
    return out;
  }
}

/** A stream that encrypts what passes through (made by encryptor(), which derives the key first). */
class Encryptor extends Transform {
  private readonly buf = new Bytes();
  private index = 0;
  private started = false;

  constructor(
    private readonly key: Buffer,
    private readonly head: Buffer,
    private readonly chunk: number,
  ) {
    super();
  }

  private seal(plain: Buffer, last: boolean) {
    const c = createCipheriv("aes-256-gcm", this.key, nonceOf(this.index));
    c.setAAD(aadOf(this.head, this.index, last));
    const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    this.index++;
    return body;
  }

  _transform(data: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    if (!this.started) this.push(this.head), (this.started = true);
    this.buf.push(data);
    // A full chunk is never the last: the last one is always shorter (maybe empty).
    while (this.buf.length >= this.chunk) this.push(this.seal(this.buf.take(this.chunk), false));
    cb();
  }

  _flush(cb: TransformCallback) {
    if (!this.started) this.push(this.head), (this.started = true);
    this.push(this.seal(this.buf.take(this.buf.length), true));
    cb();
  }
}

/** An encrypting stream for this password (the key is derived before it is returned). */
export async function encryptor(password: string, opts: { cost?: Cost; chunk?: number } = {}): Promise<Transform> {
  const cost = opts.cost ?? DEFAULT_COST;
  const chunk = opts.chunk ?? DEFAULT_CHUNK;
  const salt = randomBytes(16);
  const k = await derive(password, salt, cost);
  return new Encryptor(k.subarray(0, 32), header(cost, chunk, salt, k.subarray(32, 48)), chunk);
}

/** A stream that decrypts a .kebo-backup and checks every chunk; it fails with a BackupFileError. */
class Decryptor extends Transform {
  private readonly buf = new Bytes();
  private head: Buffer | null = null;
  private key: Buffer | null = null;
  private chunk = 0;
  private index = 0;

  constructor(private readonly password: string) {
    super();
  }

  private async start() {
    const h = this.buf.take(BACKUP_HEADER_BYTES);
    if (!h.subarray(0, 8).equals(MAGIC)) throw backupErrors.notBackup();
    if (h[8]! > FORMAT) throw backupErrors.newer();
    const cost = { log2N: h[10]!, r: h[11]!, p: h[12]! };
    const chunk = h.readUInt32BE(14);
    // Out of range: not something this app made (and never a reason to use huge memory).
    if (h[8] !== FORMAT || h[9] !== KDF_SCRYPT || cost.log2N < 10 || cost.log2N > 20 || cost.r < 1 || cost.r > 16)
      throw backupErrors.damaged();
    if (cost.p < 1 || cost.p > 4 || chunk < 64 || chunk > 16 * 1024 * 1024) throw backupErrors.damaged();
    const k = await derive(this.password, h.subarray(18, 34), cost);
    if (!timingSafeEqual(k.subarray(32, 48), h.subarray(34, 50))) throw backupErrors.password();
    this.head = h;
    this.key = k.subarray(0, 32);
    this.chunk = chunk;
  }

  private open(body: Buffer, last: boolean): Buffer | null {
    try {
      const d = createDecipheriv("aes-256-gcm", this.key!, nonceOf(this.index));
      d.setAAD(aadOf(this.head!, this.index, last));
      d.setAuthTag(body.subarray(body.length - TAG));
      return Buffer.concat([d.update(body.subarray(0, body.length - TAG)), d.final()]);
    } catch {
      return null;
    }
  }

  private drain() {
    // More than a whole chunk waiting: the first one cannot be the last.
    while (this.buf.length > this.chunk + TAG) {
      const plain = this.open(this.buf.take(this.chunk + TAG), false);
      if (!plain) throw backupErrors.damaged();
      this.index++;
      this.push(plain);
    }
  }

  _transform(data: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.buf.push(data);
    (async () => {
      if (!this.key) {
        if (this.buf.length < BACKUP_HEADER_BYTES) return;
        await this.start();
      }
      this.drain();
    })().then(() => cb(), cb);
  }

  _flush(cb: TransformCallback) {
    (async () => {
      if (!this.key) {
        if (this.buf.length < BACKUP_HEADER_BYTES) throw this.buf.length >= 8 ? backupErrors.incomplete() : backupErrors.notBackup();
        await this.start();
        this.drain();
      }
      if (this.buf.length < TAG) throw backupErrors.incomplete();
      const body = this.buf.take(this.buf.length);
      const plain = this.open(body, true);
      if (plain) return this.push(plain);
      // Fine as a middle chunk: the file was cut off right after it.
      throw this.open(body, false) ? backupErrors.incomplete() : backupErrors.damaged();
    })().then(() => cb(), cb);
  }
}

export const decryptor = (password: string): Transform => new Decryptor(password);

/** Whole buffers at once (tests, small files). */
export async function encryptBuffer(data: Buffer, password: string, opts: { cost?: Cost; chunk?: number } = {}) {
  const e = await encryptor(password, opts);
  return collect(e, data);
}
export async function decryptBuffer(data: Buffer, password: string) {
  return collect(decryptor(password), data);
}
function collect(t: Transform, data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    t.on("data", (b: Buffer) => out.push(b));
    t.on("end", () => resolve(Buffer.concat(out)));
    t.on("error", reject);
    // In pieces, as a file would arrive.
    for (let i = 0; i < data.length; i += 7919) t.write(data.subarray(i, i + 7919));
    t.end();
  });
}
