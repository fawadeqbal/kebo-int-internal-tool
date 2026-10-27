import { fileRoutes } from "@/lib/file-proxy";

/** The proof kept with a payment to a factory (bank slip, the factory's receipt). ?view=1 opens it in the browser. */
export const { GET, POST } = fileRoutes((id) => `/factory-payments/${id}/file`, "Choose a photo or PDF of the payment.");
