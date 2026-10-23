import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

/**
 * Storage interface. Business code only depends on this, so where files live
 * (MinIO, AWS S3, local disk) is a configuration choice, not a code change.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  /** Throws if the store cannot be reached (used by the health check). */
  check(): Promise<void>;
}

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set when STORAGE_DRIVER=s3`);
  return value;
};

let instance: StorageProvider | null = null;

/** STORAGE_DRIVER=s3 (MinIO / S3, the default in Docker) or local (a folder on disk). */
export function getStorage(): StorageProvider {
  if (instance) return instance;
  const driver = (process.env.STORAGE_DRIVER ?? (process.env.S3_BUCKET ? "s3" : "local")).toLowerCase();
  instance =
    driver === "s3"
      ? new S3Storage({
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION ?? "us-east-1",
          bucket: required("S3_BUCKET"),
          accessKeyId: required("S3_ACCESS_KEY"),
          secretAccessKey: required("S3_SECRET_KEY"),
          forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
        })
      : new LocalDiskStorage(process.env.UPLOAD_DIR ?? "./storage/uploads");
  return instance;
}

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;

/** Allowed upload types: documents, images, spreadsheets, CAD and archives. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "rtf",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg",
  "dwg", "dxf", "step", "stp", "iges", "igs", "stl",
  "zip", "rar", "7z",
];

export function isAllowedFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.includes(ext);
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ()]+/g, "_").slice(0, 200) || "file";
}
