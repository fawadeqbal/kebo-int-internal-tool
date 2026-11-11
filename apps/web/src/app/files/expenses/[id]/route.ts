import { uploadRoute } from "@/lib/file-proxy";

/** Uploads an expense's receipt (managers only; the API checks). */
export const { POST } = uploadRoute((id) => `/expenses/${id}/receipt`, "Choose a photo or PDF of the receipt.");
