import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { StorageProvider } from "./index";

/** Files on the server's disk. Kept for tests and for running without MinIO. */
export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  // The content type is only needed by S3; on disk the file name is enough.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async put(key: string, data: Buffer, _contentType?: string) {
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

  async check() {
    await mkdir(this.root, { recursive: true });
  }
}
