/**
 * One-off: copy files saved on disk (UPLOAD_DIR) into S3/MinIO with the same keys,
 * so existing attachments keep working after switching STORAGE_DRIVER to s3.
 * Safe to run again: files already in the bucket are skipped.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getStorage } from "../src/lib/storage";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main() {
  if ((process.env.STORAGE_DRIVER ?? "").toLowerCase() !== "s3") throw new Error("Set STORAGE_DRIVER=s3 and the S3_ settings in .env first.");
  const root = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
  const storage = getStorage();
  await storage.check();
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  });
  let copied = 0, skipped = 0;
  for await (const file of walk(root)) {
    const key = path.relative(root, file).split(path.sep).join("/");
    const exists = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key })).then(() => true, () => false);
    if (exists) { skipped++; continue; }
    await storage.put(key, await readFile(file), "application/octet-stream");
    copied++;
    console.log(`copied ${key}`);
  }
  console.log(`[files] ${copied} copied, ${skipped} already in the bucket (from ${root})`);
}

main().catch((error) => {
  console.error("[files] failed:", (error as Error).message);
  process.exit(1);
});
