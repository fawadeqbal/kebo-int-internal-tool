/**
 * Wipes the database (and the uploaded files) so it can be migrated and seeded
 * again from scratch:
 *   npm run db:reset            → empty system with the starting accounts
 *   npm run db:reset -- --demo  → the same plus sample customers, inquiries, quotations and invoices
 *
 * Every inquiry, customer, quotation, invoice, user, setting and uploaded file
 * is deleted. For safety it only runs against a database on this computer,
 * unless RESET_CONFIRM=delete-everything is set (deploy/fresh-start.sh does
 * that on the server, after taking a backup).
 */
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { rm } from "node:fs/promises";
import { Pool } from "pg";

async function emptyFiles() {
  const driver = (process.env.STORAGE_DRIVER ?? (process.env.S3_BUCKET ? "s3" : "local")).toLowerCase();
  if (driver === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) return;
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_SECRET_KEY ?? "" },
    });
    let removed = 0;
    let token: string | undefined;
    try {
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        removed += keys.length;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    } catch (error) {
      if ((error as Error).name === "NoSuchBucket") return;
      throw error;
    }
    console.log(`[reset] removed ${removed} uploaded file(s) from bucket ${bucket}`);
  } else {
    const dir = process.env.UPLOAD_DIR ?? "./storage/uploads";
    await rm(dir, { recursive: true, force: true });
    console.log(`[reset] removed uploaded files in ${dir}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (check your .env file)");
  const { hostname, pathname } = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (process.env.RESET_CONFIRM !== "delete-everything" && (process.env.NODE_ENV === "production" || !local)) {
    console.error(`[reset] refused: ${hostname} is not a database on this computer. Set RESET_CONFIRM=delete-everything to wipe it anyway.`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  console.log(`[reset] wiping database ${pathname.slice(1)} on ${hostname} …`);
  await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pool.end();
  await emptyFiles();
  console.log("[reset] done. Run the migrations and the seed next.");
}

main().catch((error) => {
  console.error("[reset] failed", error);
  process.exit(1);
});
