import { BASIS_STEPS, type BasisStep, type Incoterm } from "../enums";

/**
 * The costs between a factory's price and ours, in the order goods travel:
 * to the port (inland transport and export clearance), sea freight,
 * insurance, delivery at the destination (port charges, transport to the
 * place) and import duties.
 */

export const BASIS_STEP_LABEL: Record<BasisStep, string> = {
  to_port: "To the port",
  freight: "Sea freight",
  insurance: "Insurance",
  delivery: "Destination delivery",
  duties: "Import duties",
};

export const BASIS_STEP_HINT: Record<BasisStep, string> = {
  to_port: "Inland transport from the factory and export clearance",
  freight: "Main carriage to the destination port",
  insurance: "Cargo insurance for the voyage",
  delivery: "Destination port charges and transport to the named place",
  duties: "Import duties and taxes in the buyer's country",
};

/** What a price on each Incoterm already pays for. */
const INCLUDED: Record<Incoterm, readonly BasisStep[]> = {
  EXW: [],
  FCA: ["to_port"],
  FAS: ["to_port"],
  FOB: ["to_port"],
  CFR: ["to_port", "freight"],
  CPT: ["to_port", "freight"],
  CIF: ["to_port", "freight", "insurance"],
  CIP: ["to_port", "freight", "insurance"],
  DAP: ["to_port", "freight", "delivery"],
  DPU: ["to_port", "freight", "delivery"],
  DDP: ["to_port", "freight", "delivery", "duties"],
};

export const includedSteps = (term: Incoterm): readonly BasisStep[] => INCLUDED[term];

/**
 * Between the factory's basis and the one we sell on: the steps we must add
 * (factory EXW, we sell CFR → to the port, sea freight), and the steps the
 * factory's price already pays for that we do not sell (factory CFR, we sell
 * FOB → sea freight: ask them for FOB). Unknown basis: nothing can be said.
 */
export function basisGap(factory: Incoterm | null, selling: Incoterm): { needed: BasisStep[]; extra: BasisStep[] } | null {
  if (!factory) return null;
  const have = new Set(INCLUDED[factory]);
  const want = new Set(INCLUDED[selling]);
  return {
    needed: BASIS_STEPS.filter((s) => want.has(s) && !have.has(s)),
    extra: BASIS_STEPS.filter((s) => have.has(s) && !want.has(s)),
  };
}

/** "EXW Zhangjiagang", "FOB Qingdao", or null when not set. */
export const basisText = (term: Incoterm | null, place: string | null) => (term ? `${term}${place ? ` ${place}` : ""}` : place || null);
