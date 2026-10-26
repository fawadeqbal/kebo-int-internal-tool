import { Global, Injectable, Module } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { loadEnv, envField } from "@kebo/config";

/**
 * Where uploaded files live: any S3-compatible store (MinIO on our server, AWS
 * S3, Cloudflare R2) or a folder on disk. Files are private; they are only
 * ever streamed through the API after a permission check.
 */
const storageEnv = z.object({
  STORAGE_DRIVER: z.enum(["s3", "local"]).optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: envField.bool(true),
  UPLOAD_DIR: z.string().default("./storage/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
});

interface Driver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

class LocalDisk implements Driver {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  async get(key: string) {
    const full = this.resolve(key);
    await stat(full);
    return createReadStream(full);
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

class S3 implements Driver {
  private readonly client: S3Client;
  private ready: Promise<void> | null = null;
  constructor(private readonly bucket: string, opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }) {
    this.client = new S3Client({ endpoint: opts.endpoint || undefined, region: opts.region, forcePathStyle: opts.forcePathStyle, credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } });
  }
  /** Create the bucket on first use. */
  private ensure() {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404 && (e as Error).name !== "NotFound") throw e;
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.ensure();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType || "application/octet-stream" }));
  }
  async get(key: string) {
    await this.ensure();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error("File is missing");
    return res.Body as Readable;
  }
  async delete(key: string) {
    await this.ensure();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Documents, images, spreadsheets, CAD drawings and archives. */
export const ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "rtf",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff",
  "dwg", "dxf", "step", "stp", "iges", "igs", "stl",
  "zip", "rar", "7z",
]);

export const safeFileName = (name: string) => name.replace(/[^\w.\- ()]+/g, "_").slice(0, 200) || "file";

@Injectable()
export class StorageService {
  private readonly driver: Driver;
  readonly maxBytes: number;

  constructor() {
    const env = loadEnv(storageEnv);
    const driver = env.STORAGE_DRIVER ?? (env.S3_BUCKET ? "s3" : "local");
    if (driver === "s3") {
      if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) throw new Error("S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required when STORAGE_DRIVER=s3");
      this.driver = new S3(env.S3_BUCKET, { endpoint: env.S3_ENDPOINT, region: env.S3_REGION, accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE });
    } else {
      this.driver = new LocalDisk(env.UPLOAD_DIR);
    }
    this.maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  }

  isAllowed(fileName: string) {
    return ALLOWED_EXTENSIONS.has(fileName.split(".").pop()?.toLowerCase() ?? "");
  }

  put(key: string, data: Buffer, contentType: string) {
    return this.driver.put(key, data, contentType);
  }
  get(key: string) {
    return this.driver.get(key);
  }
  delete(key: string) {
    return this.driver.delete(key);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
