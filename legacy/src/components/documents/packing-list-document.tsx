import type { AppSettings } from "@/modules/settings/service";
import type { getPackingListDetail } from "@/modules/packing/repository";
import { formatCbm, formatKg, packingTotals } from "@/lib/packing";
import { numberToWords } from "@/lib/utils/words";
import { cn } from "@/lib/utils/cn";
import { partiesFor } from "@/modules/documents/snapshots";
import { DetailsBox, docDate, docLabel as label, Letterhead, lineCodes, PartyBox } from "./document-view";

type PackingListDetail = NonNullable<Awaited<ReturnType<typeof getPackingListDetail>>>;

const qty = (v: string) => Number(v).toLocaleString("en", { maximumFractionDigits: 2 });
const kg = (v: string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m3 = (v: string) => Number(v).toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * The packing list as it travels with the goods (screen, print and PDF).
 * Same letterhead and boxes as the quotation and invoice; no prices.
 */
export function PackingListDocument({ detail, settings: live }: { detail: PackingListDetail; settings: AppSettings }) {
  const pl = detail.packingList;
  const { customer, company: settings } = partiesFor(pl, detail.customer, live);
  const t = packingTotals(detail.items);
  const shipper = {
    companyName: null,
    contactPerson: settings.companyName,
    phone: settings.companyPhone,
    email: settings.companyEmail || null,
    address: settings.companyAddress || null,
    taxNo: settings.companyTaxNo || null,
  };
  const shipment = [
    { label: "Port of loading", value: pl.portOfLoading },
    { label: "Port of discharge", value: pl.portOfDischarge },
    { label: "Final destination", value: pl.finalDestination },
    { label: "Vessel / transport", value: pl.transport },
    { label: "Container no.", value: pl.containerNo },
    { label: "Seal no.", value: pl.sealNo },
  ].filter((r) => r.value);
  const types = [...new Set(detail.items.filter((i) => i.packages > 0).map((i) => i.packageType.toLowerCase()))];

  return (
    <article className="relative mx-auto w-full max-w-[210mm] bg-white font-doc px-5 py-6 text-[12.5px] leading-relaxed text-stone-800 [print-color-adjust:exact] sm:px-12 sm:py-11 print:p-0">
      <Letterhead settings={settings} title="Packing list" number={pl.plNo} />

      <section className="mt-5 grid gap-3 sm:grid-cols-2">
        <PartyBox title="Shipper / exporter" customer={shipper} />
        <PartyBox title="Consignee" customer={customer} />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-2">
        <DetailsBox
          title="Packing list details"
          rows={[
            { label: "Date", value: docDate(pl.packDate) },
            { label: "Invoice no.", value: <span className="font-mono">{detail.invoice.invoiceNo}</span> },
            { label: "Your RFQ ref.", value: <span className="font-mono">{detail.query.refNo}</span> },
            ...(pl.incoterm ? [{ label: "Terms of delivery", value: pl.incoterm }] : []),
          ]}
        />
        {shipment.length > 0 ? (
          <DetailsBox title="Shipment" rows={shipment.map((r) => ({ label: r.label, value: <span className="whitespace-pre-line">{r.value}</span> }))} />
        ) : (
          <div className="rounded-md border border-dashed border-stone-300 p-4 text-stone-500">
            <p className={label}>Shipment</p>
            <p className="mt-1.5">Ports, vessel and container details to follow.</p>
          </div>
        )}
      </section>

      <p className="mt-4">
        <span className="font-semibold text-stone-900">Goods:</span> {detail.query.title}
      </p>

      {/* Lines: a table on paper and wide screens, stacked on a phone */}
      <table className="mt-3 hidden w-full border-collapse sm:table">
        <thead>
          <tr className="bg-kebo text-left text-[10px] tracking-[0.1em] text-white uppercase">
            <th className="w-9 py-2.5 pl-3 font-semibold">No.</th>
            <th className="py-2.5 pr-3 font-semibold">Description of goods</th>
            <th className="w-20 py-2.5 pr-3 text-right font-semibold">Qty</th>
            <th className="w-28 py-2.5 pr-3 text-right font-semibold">Packages</th>
            <th className="w-24 py-2.5 pr-3 text-right font-semibold">Net kg</th>
            <th className="w-24 py-2.5 pr-3 text-right font-semibold">Gross kg</th>
            <th className="w-20 py-2.5 pr-3 text-right font-semibold">CBM</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it, i) => {
            const [name, ...rest] = it.description.split("\n");
            return (
              <tr key={it.id} className="border-b border-kebo-line align-top">
                <td className="py-2.5 pl-3 text-stone-500 tabular-nums">{i + 1}</td>
                <td className="py-2.5 pr-3">
                  <p className="font-medium text-stone-900">{name}</p>
                  {lineCodes(it) && <p className="mt-0.5 text-[11px] text-stone-500">{lineCodes(it)}</p>}
                  {rest.length > 0 && <p className="mt-0.5 whitespace-pre-wrap text-stone-600">{rest.join("\n")}</p>}
                </td>
                <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">
                  {qty(it.quantity)} <span className="text-stone-500">{it.unit}</span>
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {it.packages > 0 ? (
                    <>
                      {it.packages}
                      <span className="block text-[11px] text-stone-500">{it.packageType}</span>
                    </>
                  ) : (
                    <span className="text-stone-400">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{kg(it.netWeight)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{kg(it.grossWeight)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{m3(it.cbm)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="[display:table-row-group]">
          <tr className="border-t-2 border-kebo font-semibold text-stone-900">
            <td />
            <td className="py-2.5 pr-3 text-[11px] tracking-[0.12em] uppercase">Total</td>
            <td />
            <td className="py-2.5 pr-3 text-right tabular-nums">{t.packages}</td>
            <td className="py-2.5 pr-3 text-right tabular-nums">{kg(String(t.netKg))}</td>
            <td className="py-2.5 pr-3 text-right tabular-nums">{kg(String(t.grossKg))}</td>
            <td className="py-2.5 pr-3 text-right tabular-nums">{m3(String(t.cbm))}</td>
          </tr>
        </tfoot>
      </table>
      <ol className="mt-4 divide-y divide-kebo-line border-y-2 border-kebo sm:hidden">
        {detail.items.map((it, i) => {
          const [name, ...rest] = it.description.split("\n");
          return (
            <li key={it.id} className="py-3">
              <p className="font-medium text-stone-900">
                <span className="mr-1.5 text-stone-400 tabular-nums">{i + 1}.</span>
                {name}
              </p>
              {lineCodes(it) && <p className="mt-0.5 text-[11px] text-stone-500">{lineCodes(it)}</p>}
              {rest.length > 0 && <p className="mt-0.5 whitespace-pre-wrap text-stone-600">{rest.join("\n")}</p>}
              <p className="mt-1 text-stone-600 tabular-nums">
                {qty(it.quantity)} {it.unit}
                {it.packages > 0 && ` · ${it.packages} × ${it.packageType.toLowerCase()}`}
              </p>
              <p className="text-stone-500 tabular-nums">
                N.W. {kg(it.netWeight)} kg · G.W. {kg(it.grossWeight)} kg · {m3(it.cbm)} m³
              </p>
            </li>
          );
        })}
      </ol>

      {/* Totals band */}
      <section className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-kebo-deep text-white sm:grid-cols-4">
        {[
          { k: "Total packages", v: String(t.packages) },
          { k: "Net weight", v: formatKg(t.netKg) },
          { k: "Gross weight", v: formatKg(t.grossKg) },
          { k: "Volume", v: formatCbm(t.cbm) },
        ].map((x) => (
          <div key={x.k} className="bg-kebo-deep px-3 py-2.5">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-stone-300 uppercase">{x.k}</p>
            <p className="text-[14px] font-bold tabular-nums">{x.v}</p>
          </div>
        ))}
      </section>
      {t.packages > 0 && (
        <p className="mt-2 text-stone-700 italic">
          Say total {numberToWords(t.packages).toLowerCase()} ({t.packages}) {types.length === 1 ? `${types[0]}${t.packages === 1 ? "" : "s"}` : "packages"} only.
        </p>
      )}

      {/* Marks, remarks and signature */}
      <section className="mt-5 grid gap-6 break-inside-avoid sm:grid-cols-[1fr_17rem] sm:items-end">
        <div className="flex flex-col gap-4">
          {(pl.marks || pl.notes) && (
            <div className={cn("grid gap-4", pl.marks && pl.notes && "sm:grid-cols-2")}>
              {pl.marks && (
                <div className="rounded-md border border-kebo-line p-3.5">
                  <p className={label}>Shipping marks & numbers</p>
                  <p className="mt-1 font-mono text-[12px] whitespace-pre-wrap text-stone-900">{pl.marks}</p>
                </div>
              )}
              {pl.notes && (
                <div className="rounded-md border border-kebo-line p-3.5">
                  <p className={label}>Remarks</p>
                  <p className="mt-1 whitespace-pre-wrap text-stone-700">{pl.notes}</p>
                </div>
              )}
            </div>
          )}
          <p className="text-stone-600">We certify that the goods listed above are packed as described and are of the quantity and weight stated.</p>
        </div>
        <div>
          <p className={label}>For and on behalf of</p>
          <p className="mt-0.5 font-medium text-stone-900">{settings.companyName}</p>
          <div className="mt-8 border-t border-stone-400 pt-1.5 text-[11px] text-stone-500">Authorised signature and stamp</div>
        </div>
      </section>

    </article>
  );
}
