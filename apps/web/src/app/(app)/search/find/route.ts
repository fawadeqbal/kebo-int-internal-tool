import { apiFetch } from "@/lib/api";

/**
 * The top bar's search as it is typed (design "search everything"): the API's answer, passed on as it is.
 * The API finds only what this person may see; the session goes with the request.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const res = await apiFetch("/search", { query: { q: p.get("q") ?? "", kind: p.get("kind") || undefined, limit: p.get("limit") || undefined } });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
