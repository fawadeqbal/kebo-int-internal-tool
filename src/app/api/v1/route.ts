import { json } from "@/lib/api/http";

/** Lets the app check it is talking to a Kebo RFQ Desk server, and which API version. */
export function GET() {
  return json({ name: "Kebo RFQ Desk", api: 1, minAppVersion: "1.0.0" });
}
