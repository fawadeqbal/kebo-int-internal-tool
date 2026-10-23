import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Storage interface. Business code only depends on this, so the local-disk
 * implementation can be swapped for S3/MinIO later without other changes.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async getStream(key: string) {
    const full = this.resolve(key);
    await stat(full);
    return Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!instance) instance = new LocalDiskStorage(process.env.UPLOAD_DIR ?? "./storage/uploads");
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
