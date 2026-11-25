"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Plus } from "lucide-react";
import { insidePackage, itemPacked, tooBigForContainer, type CaseRow } from "@kebo/shared";
import { Badge, cn, Dash, RULES } from "@kebo/ui";
import { uploadToOrder, useFileTools } from "@/components/files/file-tools";
import { useSectionFiles } from "@/components/order-sections/section-files";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { ItemsBody, type ItemsPhoneRow } from "@/components/records/items-box";
import type { LineCase, OrderLineView } from "@/lib/types-orders";
import type { CaseShipment } from "./cases-editor";

/**
 * The Packing box read package by package (packing for machines, 25–26 Nov 2026): a row per package — its number,
 * what is in it, how it is packed (or which package it is inside), its size, weights, volume, the shipment that
 * takes it and its photos — in the one items sheet (a list on a phone), the totals under it, then where each item
 * is packed. Photos of a package and its marks are Packing's files with the package's number.
 */

const n = (v: string | number | null | undefined, digits = 2) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
const head = (d: string) => d.split("\n")[0] ?? d;
const dash = <Dash />;

const caseRow = (c: LineCase): CaseRow => ({
  ...c,
  netWeightKg: c.netWeightKg === null ? null : Number(c.netWeightKg),
  grossWeightKg: c.grossWeightKg === null ? null : Number(c.grossWeightKg),
  cbm: c.cbm === null ? null : Number(c.cbm),
});

interface Pack {
  line: OrderLineView;
  c: LineCase;
  /** The number as marked; inside another package: that one's. */
  no: string;
  inside: boolean;
}

const packedIn = (p: Pack) => (p.inside ? `In package ${p.c.inPackage}` : `${p.c.count > 1 ? `${p.c.count} × ` : ""}${p.c.packageType}`);
const sizeOf = (c: LineCase) => (c.lengthMm && c.widthMm && c.heightMm ? `${c.lengthMm} × ${c.widthMm} × ${c.heightMm}` : null);

/** A package's photos: open them here, or add one (Packing's files, with the package's number). */
function PackagePhotos({ orderId, packageNo, canAdd }: { orderId: string; packageNo: string | null; canAdd: boolean }) {
  const tools = useFileTools();
  const all = useSectionFiles("packing");
  const photos = packageNo ? all.filter((f) => f.packageNo === packageNo) : [];
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const send = (files: FileList | null) =>
    start(async () => {
      setError(null);
      for (const f of [...(files ?? [])]) {
        const r = await uploadToOrder(orderId, f, { section: "packing", kind: "photo", packageNo: packageNo ?? undefined });
        if (r.error) return setError(`${f.name}: ${r.error}`);
      }
      router.refresh();
    });
  // No number, no photo: the photo is found by the number marked on the package.
  if (!packageNo) return <span className="text-xs text-muted">{canAdd ? "Number it first" : dash}</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {photos.length > 0 && tools && (
        <button
          type="button"
          className="tap inline-flex min-h-6 items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium hover:border-primary/50"
          onClick={() => tools.view(photos[0]!, photos)}
          title={`Photos of package ${packageNo}`}
        >
          <Camera className="size-3.5 text-muted" aria-hidden />
          {photos.length}
          <span className="sr-only">{` photo${photos.length === 1 ? "" : "s"} of package ${packageNo}`}</span>
        </button>
      )}
      {canAdd && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            aria-label={`Add photos of package ${packageNo}`}
            onChange={(e) => (send(e.target.files), (e.target.value = ""))}
          />
          <button
            type="button"
            disabled={busy}
            className="tap inline-flex min-h-6 min-w-6 items-center justify-center gap-0.5 text-xs font-medium text-text-2 hover:text-primary hover:underline disabled:opacity-60"
            onClick={() => input.current?.click()}
          >
            {busy ? (
              "Sending…"
            ) : (
              <>
                <Plus className="size-3.5" aria-hidden />
                {photos.length ? (
                  <span className="sr-only">{`Add a photo of package ${packageNo}`}</span>
                ) : (
                  <>
                    Photo<span className="sr-only">{` of package ${packageNo}`}</span>
                  </>
                )}
              </>
            )}
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="basis-full text-right text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}

export function PackagesView({
  orderId,
  lines,
  shipments,
  canAddPhotos,
  label,
}: {
  orderId: string;
  /** The order's goods, each with its packages. */
  lines: OrderLineView[];
  shipments: CaseShipment[];
  canAddPhotos: boolean;
  label: string;
}) {
  const all = useSectionFiles("packing");
  const many = shipments.length > 1;
  const shipmentLabel = new Map(shipments.map((s) => [s.id, s.label]));
  const packs: Pack[] = lines.flatMap((line) =>
    (line.packing.cases ?? []).map((c) => {
      const inside = insidePackage(c);
      return { line, c, inside, no: (inside ? c.inPackage : c.caseNo)?.trim() || "" };
    }),
  );
  const byKey = new Map(packs.map((p, i) => [`p${i}`, p]));
  const of = (row: LineRow) => byKey.get(row.key)!;
  const photosCell = (p: Pack) => (
    <PackagePhotos orderId={orderId} packageNo={p.inside ? null : p.no || null} canAdd={canAddPhotos && !p.inside} />
  );

  // How it goes, under the item: packed in (or inside another package), what is in it, the shipment.
  const underOf = (p: Pack) =>
    [
      packedIn(p),
      p.c.contents,
      many && p.c.shipmentId && shipmentLabel.has(p.c.shipmentId) && `Shipment ${shipmentLabel.get(p.c.shipmentId)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  // Five columns: the box keeps to the page's body beside the panel (no sideways scroll on a laptop).
  const columns: LineColumn[] = [
    {
      key: "what",
      label: "What is in it",
      width: "minmax(0,1fr)",
      format: (_v, r) => {
        const p = of(r);
        return (
          <>
            <span className="text-muted">{p.line.no}</span> {head(p.line.description)}
            <span className="block text-xs text-muted">
              {underOf(p)}
              {many && !p.c.shipmentId && <span className="text-warn"> · no shipment yet</span>}
            </span>
          </>
        );
      },
    },
    {
      key: "size",
      label: "Size (mm)",
      width: "7.5rem",
      format: (_v, r) => {
        const p = of(r);
        const s = sizeOf(p.c);
        return s ? (
          <>
            <span className="tabular">{s.replaceAll(" × ", "×")}</span>
            {tooBigForContainer(caseRow(p.c)) && (
              <Badge size="sm" tone="warn" className="mt-0.5">
                Flat rack
              </Badge>
            )}
          </>
        ) : (
          dash
        );
      },
    },
    {
      key: "gross",
      label: "Gross kg",
      width: "4.75rem",
      align: "right",
      format: (_v, r) => (of(r).c.grossWeightKg ? n(of(r).c.grossWeightKg) : dash),
    },
    { key: "cbm", label: "CBM", width: "4.25rem", align: "right", format: (_v, r) => (of(r).c.cbm ? n(of(r).c.cbm, 3) : dash) },
    { key: "photos", label: "Photos", width: "5rem", align: "right", format: (_v, r) => photosCell(of(r)) },
  ];
  const rows: LineRow[] = packs.map((_p, i) => ({ key: `p${i}`, parentKey: null, values: {} }));
  const phone: ItemsPhoneRow[] = packs.map((p, i) => ({
    key: `p${i}`,
    no: p.no || "–",
    part: false,
    title: head(p.line.description),
    under: underOf(p),
    sub:
      [sizeOf(p.c) && `${sizeOf(p.c)} mm`, p.c.grossWeightKg && `${n(p.c.grossWeightKg)} kg`, p.c.cbm && `${n(p.c.cbm, 3)} CBM`]
        .filter(Boolean)
        .join(" · ") || "No size or weight of its own",
    amount: photosCell(p),
  }));

  // Totals: the packages, weights and volume (rows inside others add nothing), and how many are photographed.
  const own = packs.filter((p) => !p.inside);
  const sum = (f: (c: LineCase) => number) => own.reduce((t, p) => t + (f(p.c) || 0), 0);
  const numbered = own.filter((p) => p.no && p.c.count > 0);
  const shot = numbered.filter((p) => all.some((f) => f.packageNo === p.no)).length;
  const fact = (label: string, value: string) => (
    <span className="text-muted">
      {label} <span className="font-semibold text-text tabular">{value}</span>
    </span>
  );
  const totals = (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-3 py-2 text-sm">
        {fact(
          "Packages",
          n(
            sum((c) => c.count),
            0,
          ),
        )}
        {fact("Gross", `${n(sum((c) => Number(c.grossWeightKg)))} kg`)}
        {fact("Net", `${n(sum((c) => Number(c.netWeightKg)))} kg`)}
        {fact(
          "Volume",
          `${n(
            sum((c) => Number(c.cbm)),
            3,
          )} CBM`,
        )}
        {numbered.length > 0 && fact("Photos", `${shot} of ${numbered.length}`)}
      </div>
      {/* Where each item is packed: worked out from the packages, never typed. */}
      <div className={cn(RULES.box.inset, "border-t border-line py-2")} role="list" aria-label="Where each item is packed">
        <p className="pb-1 text-xs font-bold text-text-2">Where each item is packed</p>
        {lines.map((l) => {
          const mine = packs.filter((p) => p.line.id === l.id);
          const where = [...new Set(mine.filter((p) => !p.inside).map((p) => p.no || "unnumbered"))];
          const into = [...new Set(mine.filter((p) => p.inside).map((p) => p.no))];
          const packed = itemPacked((l.packing.cases ?? []).map(caseRow));
          return (
            <div key={l.id} role="listitem" className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1 text-sm">
              <span className="min-w-0 flex-[1_1_12rem]">
                <span className="text-muted">{l.no}</span> {head(l.description)}
              </span>
              <span className="text-text-2">
                {[
                  where.length ? `Package${where.length === 1 ? "" : "s"} ${where.join(", ")}` : null,
                  into.length ? `inside ${into.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
              <Badge size="sm" tone={packed ? "ok" : "warn"} dot>
                {packed ? "Packed" : "Not packed yet"}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <ItemsBody
      label={label}
      rows={rows}
      columns={columns}
      numbers={packs.map((p) => (p.no || "–").replace(/-/g, "\u2011"))}
      phone={phone}
      totals={totals}
      empty="No packages yet."
    />
  );
}
