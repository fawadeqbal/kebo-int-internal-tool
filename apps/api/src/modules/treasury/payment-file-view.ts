/** What the payment views show about the file (opened at /files/<id>). */
export const fileView = (p: { fileId: string | null; fileName: string | null; fileType: string | null; fileSize: number | null }) =>
  p.fileId ? { id: p.fileId, name: p.fileName ?? "file", type: p.fileType ?? "application/octet-stream", size: p.fileSize ?? 0 } : null;
