import { uploadRoute } from "@/lib/file-proxy";

/** Uploads the proof kept with a payment from a customer (bank slip, transfer screenshot). */
export const { POST } = uploadRoute((id) => `/payments/${id}/file`, "Choose a photo or PDF of the payment.");
