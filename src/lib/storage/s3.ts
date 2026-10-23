import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./index";

export interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * Any S3-compatible store: MinIO on our own server (default), AWS S3,
 * Cloudflare R2, Backblaze B2… The bucket is private; files are only ever
 * streamed through the app after a permission check.
 */
export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private ready: Promise<void> | null = null;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      endpoint: opts.endpoint || undefined,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  /** Create the bucket on first use if it does not exist yet. */
  private ensureBucket(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
        } catch (error) {
          const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (status !== 404 && (error as Error).name !== "NotFound" && (error as Error).name !== "NoSuchBucket") throw error;
          await this.client.send(new CreateBucketCommand({ Bucket: this.opts.bucket }));
        }
      })().catch((error) => {
        this.ready = null; // try again on the next request
        throw error;
      });
    }
    return this.ready;
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: data, ContentType: contentType || "application/octet-stream" }),
    );
  }

  async getStream(key: string) {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    if (!res.Body) throw new Error("File is empty or missing");
    return res.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async check() {
    await this.ensureBucket();
  }
}
