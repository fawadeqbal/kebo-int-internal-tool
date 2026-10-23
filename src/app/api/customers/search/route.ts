import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { searchCustomers } from "@/modules/customers/repository";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const results = await searchCustomers(q.slice(0, 100), 8);
  return NextResponse.json(results);
}
