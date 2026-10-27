import { fileRoutes } from "@/lib/file-proxy";

/** An expense's receipt (managers only; the API checks). ?view=1 opens a PDF or a photo in the browser. */
export const { GET, POST } = fileRoutes((id) => `/expenses/${id}/receipt`, "Choose a photo or PDF of the receipt.");
