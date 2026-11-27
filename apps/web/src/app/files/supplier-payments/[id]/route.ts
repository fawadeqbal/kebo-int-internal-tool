import { uploadRoute } from "@/lib/file-proxy";

/** Uploads the proof kept with a payment to a supplier (bank slip, the supplier's receipt). */
export const { POST } = uploadRoute((id) => `/supplier-payments/${id}/file`, "Choose a photo or PDF of the payment.");
