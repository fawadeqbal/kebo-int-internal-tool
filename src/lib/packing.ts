/**
 * Packing list totals. Weights are added in grams (0.01 kg = 10 g) and volume in
 * cubic centimetres (0.001 m³ = 1,000 cm³), as integers, so totals never drift.
 */
export interface PackingLineInput {
  quantity: string | number;
  packages: string | number;
  netWeight: string | number;
  grossWeight: string | number;
  cbm: string | number;
}

const num = (v: string | number) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function packingTotals(lines: PackingLineInput[]) {
  let packages = 0;
  let net = 0; // grams
  let gross = 0; // grams
  let volume = 0; // cm³
  for (const l of lines) {
    packages += Math.round(num(l.packages));
    net += Math.round(num(l.netWeight) * 1000);
    gross += Math.round(num(l.grossWeight) * 1000);
    volume += Math.round(num(l.cbm) * 1_000_000);
  }
  return { packages, netKg: net / 1000, grossKg: gross / 1000, cbm: volume / 1_000_000 };
}

export const formatKg = (kg: number) => `${kg.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
export const formatCbm = (m3: number) => `${m3.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³`;

export const PACKAGE_TYPES = ["Wooden case", "Carton", "Pallet", "Crate", "Bundle", "Drum", "Bag", "Roll", "Unpacked"] as const;
export const UNITS = ["pcs", "sets", "units", "kg", "m", "rolls", "boxes", "lots"] as const;
