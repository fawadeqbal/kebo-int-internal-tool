/**
 * Where to track a shipment (an order's Shipping › Track): the shipping line's own tracking page,
 * worked out from the container's owner code or the B/L's prefix (the first four letters), or a
 * general tracker when the line is not known. An air waybill opens the general air cargo tracker.
 */
export interface TrackingLink {
  /** "Maersk", "MSC"… or "Track-trace" (general). */
  carrier: string;
  url: string;
  /** What is tracked: the container or the B/L / AWB. */
  number: string;
}

type Carrier = { name: string; codes: string[]; url: (n: string) => string };

const e = encodeURIComponent;
const CARRIERS: Carrier[] = [
  { name: "Maersk", codes: ["MAEU", "MSKU", "MRKU", "MRSU", "MCPU", "SEAU", "SUDU"], url: (n) => `https://www.maersk.com/tracking/${e(n)}` },
  { name: "MSC", codes: ["MSCU", "MEDU", "MSDU", "MSMU", "MSNU", "TGBU"], url: (n) => `https://www.msc.com/en/track-a-shipment?trackingNumber=${e(n)}` },
  { name: "COSCO", codes: ["COSU", "CBHU", "CSNU", "CCLU", "FCIU", "TCNU"], url: (n) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number=${e(n)}` },
  { name: "CMA CGM", codes: ["CMAU", "CMDU", "CGMU", "APLU", "ECMU", "ANNU"], url: (n) => `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${e(n)}` },
  { name: "Hapag-Lloyd", codes: ["HLCU", "HLXU", "HAMU", "UACU"], url: (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${e(n)}` },
  { name: "ONE", codes: ["ONEY", "ONEU", "NYKU", "MOLU", "KKFU"], url: (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${e(n)}` },
  { name: "ZIM", codes: ["ZIMU", "ZCSU"], url: (n) => `https://www.zim.com/tools/track-a-shipment?consnumber=${e(n)}` },
];

const general = (n: string, air: boolean): TrackingLink => ({
  carrier: "Track-trace",
  url: air ? `https://www.track-trace.com/aircargo?number=${e(n)}` : `https://www.track-trace.com/container?number=${e(n)}`,
  number: n,
});

/** The tracking page for a shipment: its container first (the line's own page), else its B/L; null with neither. */
export function trackingLink(s: { mode?: string | null; containerNo?: string | null; blNo?: string | null }): TrackingLink | null {
  const clean = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "").toUpperCase();
  const air = s.mode === "air";
  const bl = clean(s.blNo);
  if (air) return bl ? general(bl, true) : null;
  const container = clean(s.containerNo);
  for (const n of [container, bl].filter(Boolean)) {
    const c = CARRIERS.find((x) => x.codes.includes(n.slice(0, 4)));
    if (c) return { carrier: c.name, url: c.url(n), number: n };
  }
  const n = container || bl;
  return n ? general(n, false) : null;
}
