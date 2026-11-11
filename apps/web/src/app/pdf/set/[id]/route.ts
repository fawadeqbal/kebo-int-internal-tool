import { cookies } from "next/headers";
import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";
import { paperDone } from "@kebo/shared";
import { apiFetch, SESSION_COOKIE } from "@/lib/api";
import type { OrderPapers, PaperRow } from "@/lib/types-papers";
import { attachmentHeaders, pdfName, withChromium, type Render } from "../../render";
import { UUID } from "@/lib/ids";

/**
 * The order's papers in one download (Documents › Papers › Download the set):
 *
 *   /pdf/set/<order id>?as=pdf|zip&keys=<paper key>,…
 *
 * Without keys: the papers for the bank (the set) that are ready. Papers the app
 * makes are rendered from their print page (as /pdf/<paper>/<order id> does);
 * uploaded papers are their file. As one PDF, PDFs are joined page by page and
 * photos become a page each; other files (Word, Excel) only go in the zip.
 * Papers kept elsewhere have no file and are left out. The API decides what the
 * person may see: the list of papers and every file are asked for as them.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;
const A4 = { w: 595.28, h: 841.89 };

type Part = { name: string; type: string; data: Uint8Array };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const as = url.searchParams.get("as") === "zip" ? "zip" : "pdf";
  const keys = (url.searchParams.get("keys") ?? "").split(",").filter((k) => /^[\w:.-]{1,120}$/.test(k));
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer !== undefined && !TOKEN.test(bearer)) return new Response("Sign in first", { status: 401 });
  const session = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return new Response("Sign in first", { status: 401 });
  const asThem = { auth: false, headers: { authorization: `Bearer ${session}` } } as const;

  const res = await apiFetch(`/orders/${id}/papers`, asThem);
  if (!res.ok) return new Response(res.status === 404 ? "Not found" : "Not allowed", { status: res.status });
  const list = (await res.json()) as OrderPapers;
  const rows = keys.length ? list.papers.filter((p) => keys.includes(p.key)) : list.papers.filter((p) => p.inSet && paperDone(p.state));
  const made = (r: PaperRow) => r.source === "app" && r.printable && (paperDone(r.state) || r.live || r.state === "draft");
  const usable = rows.filter((r) => made(r) || r.doc?.file);
  if (!usable.length) return new Response("None of these papers has a file or a print yet.", { status: 404 });

  const printPath = (r: PaperRow) => {
    const q = new URLSearchParams(r.ref ? { ref: r.ref } : {});
    return `/print/orders/${id}/${r.kind}${q.size ? `?${q}` : ""}`;
  };
  const collect = async (render: Render | null) => {
    const parts: Part[] = [];
    for (const r of usable) {
      // Made by the app: its print (a signed scan stays in the files); uploaded: the file itself.
      if (!made(r) && r.doc?.file) {
        const f = await apiFetch(`/files/${r.doc.file.id}`, asThem);
        if (!f.ok) continue;
        parts.push({
          name: r.doc.file.name,
          type: (f.headers.get("content-type") ?? "").split(";")[0]!.trim(),
          data: new Uint8Array(await f.arrayBuffer()),
        });
      } else if (render) {
        parts.push({ name: pdfName(`${r.label} ${r.number ?? ""}`.trim()), type: "application/pdf", data: await render(printPath(r)) });
      }
    }
    return parts;
  };
  const needsChromium = usable.some(made);
  const parts = needsChromium ? await withChromium(session, (render) => collect(render)) : await collect(null);
  if (parts instanceof Response) return parts;

  if (as === "zip") {
    const used = new Set<string>();
    const entries: Record<string, Uint8Array> = {};
    parts.forEach((p, i) => {
      let name = `${String(i + 1).padStart(2, "0")} ${p.name}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
      used.add(name.toLowerCase());
      entries[name] = p.data;
    });
    return new Response(Buffer.from(zipSync(entries, { level: 0 })), {
      headers: attachmentHeaders(`${list.refNo} papers.zip`, "application/zip"),
    });
  }

  const out = await PDFDocument.create();
  for (const p of parts) {
    try {
      if (p.type === "application/pdf") {
        const doc = await PDFDocument.load(p.data, { ignoreEncryption: true });
        for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
      } else if (p.type === "image/png" || p.type === "image/jpeg") {
        const img = p.type === "image/png" ? await out.embedPng(p.data) : await out.embedJpg(p.data);
        const scale = Math.min((A4.w - 56) / img.width, (A4.h - 56) / img.height, 1);
        const page = out.addPage([A4.w, A4.h]);
        page.drawImage(img, {
          x: (A4.w - img.width * scale) / 2,
          y: (A4.h - img.height * scale) / 2,
          width: img.width * scale,
          height: img.height * scale,
        });
      }
      // Other files (Word, Excel…) cannot be pages: the zip has them.
    } catch {
      // A broken or protected PDF is left out rather than failing the whole set.
    }
  }
  if (!out.getPageCount())
    return new Response("None of these papers could be joined into one PDF. Download them as a zip.", { status: 422 });
  out.setTitle(`${list.refNo} papers`);
  return new Response(Buffer.from(await out.save()), { headers: attachmentHeaders(pdfName(`${list.refNo} papers`), "application/pdf") });
}
