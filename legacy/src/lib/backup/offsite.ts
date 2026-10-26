import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptFile } from "./crypto";

/**
 * Off-site copy of the nightly backups. The backup container writes
 * db-*.sql.gz and files-*.tar.gz to /backups; this sends each new one,
 * encrypted, to an S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3,
 * Wasabi…) and deletes copies older than OFFSITE_RETENTION_DAYS there.
 * Off unless OFFSITE_S3_BUCKET is set.
 */
export interface OffsiteConfig {
  bucket: string;
  prefix: string;
  retentionDays: number;
  passphrase: string;
  dir: string;
  client: S3Client;
}

export function offsiteConfig(env = process.env): OffsiteConfig | null {
  if (!env.OFFSITE_S3_BUCKET) return null;
  const missing = ["OFFSITE_S3_ACCESS_KEY", "OFFSITE_S3_SECRET_KEY", "BACKUP_ENCRYPTION_KEY"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Off-site backup is half set up: also set ${missing.join(", ")} in .env`);
  if (env.BACKUP_ENCRYPTION_KEY!.length < 20) throw new Error("BACKUP_ENCRYPTION_KEY must be at least 20 characters (use: openssl rand -base64 32)");
  return {
    bucket: env.OFFSITE_S3_BUCKET,
    prefix: (env.OFFSITE_S3_PREFIX ?? "kebo-rfq/").replace(/^\/+/, ""),
    retentionDays: Number(env.OFFSITE_RETENTION_DAYS) || 30,
    passphrase: env.BACKUP_ENCRYPTION_KEY!,
    dir: env.BACKUP_DIR || "/backups",
    client: new S3Client({
      region: env.OFFSITE_S3_REGION || "auto",
      endpoint: env.OFFSITE_S3_ENDPOINT || undefined,
      forcePathStyle: env.OFFSITE_S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: env.OFFSITE_S3_ACCESS_KEY!, secretAccessKey: env.OFFSITE_S3_SECRET_KEY! },
    }),
  };
}

const BACKUP_FILE = /^(db|files)-\d{4}-\d{2}-\d{2}_\d{4}\.(sql|tar)\.gz$/;

async function remoteObjects(cfg: OffsiteConfig) {
  const objects: { key: string; modified: Date }[] = [];
  let token: string | undefined;
  do {
    const page = await cfg.client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key && o.LastModified) objects.push({ key: o.Key, modified: o.LastModified });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

/** One pass: upload what is missing, then prune old copies. Safe to run as often as you like. */
export async function syncOffsite(cfg: OffsiteConfig, log: (m: string) => void = console.log) {
  const remote = await remoteObjects(cfg);
  const have = new Set(remote.map((o) => o.key));
  const names = (await fs.readdir(cfg.dir)).filter((n) => BACKUP_FILE.test(n)).sort();
  let uploaded = 0;
  for (const name of names) {
    const key = `${cfg.prefix}${name}.enc`;
    if (have.has(key)) continue;
    const src = path.join(cfg.dir, name);
    const stat = await fs.stat(src);
    if (Date.now() - stat.mtimeMs < 2 * 60_000) continue; // still being written
    const tmp = path.join(tmpdir(), `${name}.${process.pid}.enc`);
    try {
      await encryptFile(src, tmp, cfg.passphrase);
      const { size } = await fs.stat(tmp);
      await cfg.client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: createReadStream(tmp), ContentLength: size, ContentType: "application/octet-stream" }),
      );
      uploaded += 1;
      log(`[offsite] uploaded ${key} (${(size / 1024 / 1024).toFixed(1)} MB, encrypted)`);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const cutoff = Date.now() - cfg.retentionDays * 86400_000;
  let pruned = 0;
  for (const o of remote)
    if (o.modified.getTime() < cutoff && o.key.endsWith(".enc")) {
      await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: o.key }));
      pruned += 1;
    }
  if (uploaded || pruned) log(`[offsite] ${uploaded} uploaded, ${pruned} older than ${cfg.retentionDays} days removed`);
  return { uploaded, pruned, remote: remote.length };
}
