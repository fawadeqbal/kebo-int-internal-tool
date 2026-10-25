import { apiUser, handle, json, searchParams } from "@/lib/api/http";
import { searchSuppliers } from "@/modules/sourcing/repository";

export const runtime = "nodejs";

/** ?q — the factory search box: recently used factories when empty, else matches on name, email, phone or WeChat (8 at most). */
export const GET = handle(async (request: Request) => {
  await apiUser("sourcing.manage");
  return json({ rows: await searchSuppliers(searchParams(request).q ?? "") });
});
