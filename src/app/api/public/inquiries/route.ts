import { z } from "zod";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { normalizeFields, websiteInquirySchema } from "@/modules/inquiries/schema";
import { receiveWebsiteInquiry } from "@/modules/inquiries/service";

/**
 * Public endpoint for the RFQ / inquiry form on the company website.
 * Accepts JSON, multipart/form-data or a normal HTML form post.
 * Protection: allowed origins (CORS), a hidden honeypot field, per-IP rate limit and size limits.
 */
export const dynamic = "force-dynamic";

const allowedOrigins = () =>
  (process.env.PUBLIC_FORM_ORIGINS ?? "https://keboint.com,https://www.keboint.com")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && allowedOrigins().includes(origin);
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (Number(request.headers.get("content-length") ?? 0) > 100_000) return null;
  try {
    if (type.includes("application/json")) return (await request.json()) as Record<string, unknown>;
    if (type.includes("form")) return Object.fromEntries((await request.formData()).entries());
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html") && !(request.headers.get("content-type") ?? "").includes("json");
  const reply = (status: number, body: { ok: boolean; message: string; reference?: string; errors?: Record<string, string[] | undefined> }) => {
    if (wantsHtml) {
      const url = new URL("/inquiry-received", request.url);
      url.searchParams.set(body.ok ? "ref" : "error", body.ok ? (body.reference ?? "") : body.message);
      if (origin) url.searchParams.set("back", origin);
      return Response.redirect(url, 303);
    }
    return Response.json(body, { status, headers });
  };

  // Browsers send Origin on cross-site posts; reject other websites.
  if (origin && !allowedOrigins().includes(origin) && origin !== new URL(request.url).origin)
    return reply(403, { ok: false, message: "This website is not allowed to send inquiries." });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`inquiry:${ip}`, 5, 10 * 60 * 1000).allowed)
    return reply(429, { ok: false, message: "Too many inquiries were sent. Please try again in a few minutes or contact us on WhatsApp." });

  const raw = await readBody(request);
  if (!raw) return reply(400, { ok: false, message: "We could not read the form. Please try again." });
  const fields = normalizeFields(raw);

  // Bots fill every field, including the hidden one. Pretend it worked and drop it.
  if (fields.honeypot) return reply(200, { ok: true, message: "Thank you." });

  const parsed = websiteInquirySchema.safeParse(fields);
  if (!parsed.success)
    return reply(422, {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Please check the form.",
      errors: z.flattenError(parsed.error).fieldErrors,
    });

  try {
    const { refNo } = await receiveWebsiteInquiry(parsed.data);
    return reply(201, { ok: true, reference: refNo, message: `Thank you. We have your request (ref. ${refNo}). Our sourcing team will reply within one working day.` });
  } catch (error) {
    console.error("[inquiry] failed", error);
    return reply(500, { ok: false, message: "Sorry, something went wrong. Please email or WhatsApp us instead." });
  }
}
