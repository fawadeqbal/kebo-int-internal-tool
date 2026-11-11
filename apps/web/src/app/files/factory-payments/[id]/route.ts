import { uploadRoute } from "@/lib/file-proxy";

/** Uploads the proof kept with a payment to a factory (bank slip, the factory's receipt). */
export const { POST } = uploadRoute((id) => `/factory-payments/${id}/file`, "Choose a photo or PDF of the payment.");
