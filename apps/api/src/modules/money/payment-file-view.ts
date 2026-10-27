/** What the payment views show about the file. */
export const fileView = (p: { fileName: string | null; fileType: string | null; fileSize: number | null; fileKey: string | null }) =>
  p.fileKey ? { name: p.fileName ?? "file", type: p.fileType ?? "application/octet-stream", size: p.fileSize ?? 0 } : null;
