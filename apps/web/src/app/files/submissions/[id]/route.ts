import { uploadRoute } from "@/lib/file-proxy";

/** Uploads the bank slip or receipt kept with money sent for a manager to verify. */
export const { POST } = uploadRoute((id) => `/submissions/${id}/file`, "Choose a photo or PDF of the bank slip or receipt.");
