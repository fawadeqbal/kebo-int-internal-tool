import type { AttachmentKind } from "@kebo/shared";

/** One file waiting to be sent with an inquiry, an offer or a new inquiry: what it is, a note, its progress. */
export type Staged = { key: string; file: File; kind: AttachmentKind; note: string; progress: number | null; error: string | null };

/** Sends one file with progress (XHR: fetch cannot report upload progress). */
export function send(dealId: string, s: Staged, onProgress: (p: number) => void, extra: Record<string, string> = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const body = new FormData();
    body.set("file", s.file, s.file.name);
    body.set("kind", s.kind);
    for (const [k, v] of Object.entries(extra)) body.set(k, v);
    if (s.note.trim()) body.set("note", s.note.trim());
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/files/inquiries/${dealId}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(null);
      try {
        resolve((JSON.parse(xhr.responseText) as { error?: string }).error ?? `Upload failed (${xhr.status})`);
      } catch {
        resolve(xhr.status === 413 ? "This file is too large." : `Upload failed (${xhr.status})`);
      }
    };
    xhr.onerror = () => resolve("The connection dropped. Try again.");
    xhr.send(body);
  });
}
