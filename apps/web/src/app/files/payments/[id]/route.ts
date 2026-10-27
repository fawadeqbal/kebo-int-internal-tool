import { fileRoutes } from "@/lib/file-proxy";

/** The proof kept with a payment from a customer (bank slip, transfer screenshot). ?view=1 opens it in the browser. */
export const { GET, POST } = fileRoutes((id) => `/payments/${id}/file`, "Choose a photo or PDF of the payment.");
