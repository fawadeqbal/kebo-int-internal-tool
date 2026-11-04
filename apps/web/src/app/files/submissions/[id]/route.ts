import { fileRoutes } from "@/lib/file-proxy";

/** The bank slip or receipt sent with money waiting for approval. ?view=1 opens it in the browser. */
export const { GET } = fileRoutes((id) => `/submissions/${id}/file`, "Choose a photo or PDF of the bank slip or receipt.");
