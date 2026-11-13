import type { ISODate } from "@kebo/utils";
import type { Incoterm } from "../enums";

/**
 * Single source of truth, PR 3: the shipment is the shipment. The B/L, the day it left, the container,
 * the seal, the vessel, the ports and ETD/ETA live on the order's shipments only; every screen, paper,
 * check and report reads them through these rules (the order keeps only its contract destination,
 * Order.portOfDischarge, the default for a new shipment's port of discharge).
 */

/** E and F terms: the Incoterm place is where the goods are handed over at origin (the port of loading). */
export const LOADING_TERMS: readonly Incoterm[] = ["EXW", "FCA", "FAS", "FOB"];

/** The Incoterm place is the port of loading (E/F terms); otherwise (C/D terms) it is the destination. */
export const placeIsLoading = (incoterm: string) => (LOADING_TERMS as readonly string[]).includes(incoterm);

export interface PortsOrder {
  incoterm: string;
  incotermPlace: string | null;
  /** The contract destination (where the goods are unloaded), when typed on the order. */
  portOfDischarge: string | null;
}

/**
 * The ports of an order's shipment: the shipment's own when typed; else from the order's terms: E/F terms
 * (EXW, FCA, FAS, FOB) load at the Incoterm place; C/D terms (CFR, CIF, CPT, CIP, DAP, DPU, DDP) discharge
 * there, unless the order names its destination. With no shipment: what a new shipment starts with.
 */
export function portsOf(
  o: PortsOrder,
  s?: { portOfLoading: string | null; portOfDischarge: string | null } | null,
): { portOfLoading: string | null; portOfDischarge: string | null } {
  const loading = placeIsLoading(o.incoterm);
  return {
    portOfLoading: s?.portOfLoading || (loading ? o.incotermPlace || null : null),
    portOfDischarge: s?.portOfDischarge || o.portOfDischarge || (loading ? null : o.incotermPlace || null),
  };
}

/** A shipment's place in its order: the first made comes first (then by id, so the order never changes). */
export interface ShipmentKey {
  id: string;
  createdAt: Date | string;
}

const at = (d: Date | string) => (typeof d === "string" ? Date.parse(d) : d.getTime());

/** The order's shipments in their order: Shipment 1 (the primary) first. */
export function shipmentsInOrder<T extends ShipmentKey>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => at(a.createdAt) - at(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * The order's shipment the papers, the overview, the sections, the LC checks and the reports speak of:
 * Shipment 1, the first one made. Null when the order has none yet.
 */
export function primaryShipment<T extends ShipmentKey>(list: readonly T[]): T | null {
  return shipmentsInOrder(list)[0] ?? null;
}

/** "Shipped on": the day the first of the order's shipments left (null: none has). */
export function shippedOnOf(list: readonly { departedOn: ISODate | null }[]): ISODate | null {
  const days = list.map((s) => s.departedOn).filter((d): d is ISODate => !!d);
  return days.length ? days.sort()[0]! : null;
}

/** Shipped by our ship-by date (Insights' "on time"): null until it has shipped, or without a ship-by. */
export function shippedOnTime(shipBy: ISODate | null, shippedOn: ISODate | null): boolean | null {
  return shipBy && shippedOn ? shippedOn <= shipBy : null;
}

/**
 * Our ship-by against the LC's latest shipment date (owner, 3 Nov 2026: keep our own, show both, warn when
 * ours is later). `late`: ours is after the LC's; null when one of them is not known.
 */
export function shipByVsLc(shipBy: ISODate | null, lcLatest: ISODate | null): { late: boolean; text: string } | null {
  if (!shipBy || !lcLatest) return null;
  const late = shipBy > lcLatest;
  return {
    late,
    text: late
      ? `our ship-by ${shipBy} is after the LC's latest shipment ${lcLatest} · ship by ${lcLatest}, or ask for an amendment`
      : `ship by ${shipBy} · LC latest ${lcLatest}`,
  };
}
