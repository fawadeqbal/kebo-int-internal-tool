import type {
  BalanceWhen,
  LcCheck,
  LcTerms,
  BankContractStatus,
  BankStepKind,
  ClaimStatus,
  DeliveryCondition,
  FactoryRequestStatus,
  FlowState,
  FlowStep,
  OrderDocumentKind,
  OrderDocumentStatus,
  PaymentRoute,
  RequestChannel,
  SatResult,
  ShipMode,
  ShipmentStatus,
} from "@kebo/shared";

/** GET /orders/:id/flow — the order after the customer accepted; a module switched off for the company is null. */
export interface OrderFlow {
  orderId: string;
  refNo: string;
  steps: { key: FlowStep; label: string; state: FlowState; sub: string }[];
  modules: { bankContracts: boolean; production: boolean; shipping: boolean; bankDocuments: boolean; deliverySat: boolean };
  payment: {
    route: PaymentRoute | null;
    routeLabel: string | null;
    balanceWhen: BalanceWhen | null;
    lcTerms: LcTerms | null;
    lcDays: number | null;
    /** "LC, deferred 90 days". */
    summary: string | null;
    /** The LC against the order (LC orders): ok null = not known yet. */
    lcChecks: LcCheck[] | null;
    lcChecksLine: string | null;
    depositIn: boolean;
    bankContract: BankContract | null;
  };
  factory: { orderedOn: string | null; orderNo?: string | null; readyOn: string | null; factories: { id: string; name: string }[] };
  production: { steps: ProductionStepView[]; suggested: string[] } | null;
  shipping: { shipments: ShipmentView[] } | null;
  documents: { set: FlowDocument[]; bankSteps: BankStepView[] } | null;
  delivery: DeliveryView | null;
}

export interface BankContract {
  number: string | null;
  status: BankContractStatus;
  customerBank: string | null;
  ourBank: string | null;
  amount: number | null;
  currency: string | null;
  openedOn: string | null;
  latestShipOn: string | null;
  expiresOn: string | null;
  note: string | null;
}

export interface ProductionStepView {
  id: string;
  title: string;
  factory: { id: string; name: string } | null;
  plannedOn: string | null;
  doneOn: string | null;
  note: string | null;
  late: boolean;
}

export interface ShipmentView {
  id: string;
  /** 1 for Shipment 1 (the primary: the first made, what the papers print), 2… */
  n?: number;
  mode: ShipMode;
  status: ShipmentStatus;
  forwarder: string | null;
  bookingNo: string | null;
  blNo: string | null;
  vessel: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  containerNo: string | null;
  containerType: string | null;
  sealNo?: string | null;
  loadedOn?: string | null;
  /** The container's verified gross mass, kg ("21500.5"). */
  vgmKg?: string | null;
  etd: string | null;
  eta: string | null;
  departedOn: string | null;
  arrivedOn: string | null;
  note: string | null;
}

export interface FlowDocument {
  /** Null: not recorded yet. */
  id: string | null;
  kind: OrderDocumentKind;
  label: string;
  required: boolean;
  status: OrderDocumentStatus;
  number: string | null;
  issuedOn: string | null;
  shipmentId: string | null;
  note: string | null;
  /** Kept elsewhere: where it is. */
  keptWhere: string | null;
  /** Made by the app: the final paper. */
  paperId: string | null;
  file: { id: string; name: string; size: number } | null;
  printable: "proforma" | "packing-list" | null;
}

export interface BankStepView {
  step: BankStepKind;
  label: string;
  doneOn: string | null;
  courier: string | null;
  reference: string | null;
  note: string | null;
  /** "Money reached us": the payment that recorded it. */
  paymentId?: string | null;
}

export interface SatCheckView {
  id: string;
  item: string;
  result: SatResult;
  note: string | null;
}

export interface ClaimView {
  id: string;
  title: string;
  detail: string | null;
  status: ClaimStatus;
  statusLabel: string;
  openedOn: string;
  resolvedOn: string | null;
  resolution: string | null;
}

export interface DeliveryView {
  deliveredOn: string | null;
  condition: DeliveryCondition | null;
  note: string | null;
  /** Who received the goods at the customer's. */
  receivedBy?: string | null;
  satEngineer: { id: string; name: string } | null;
  satPlannedOn: string | null;
  satDoneOn: string | null;
  satSignedBy: string | null;
  sat: SatCheckView[];
  suggestedSat: string[];
  claims: ClaimView[];
}

/** GET /inquiries/:id/factory-requests */
export interface FactoryRequests {
  items: {
    id: string;
    factory: { id: string; name: string };
    status: FactoryRequestStatus;
    statusLabel: string;
    sentOn: string;
    replyBy: string | null;
    late: boolean;
    channel: RequestChannel | null;
    waitingDays: number | null;
    factoryQuoteId: string | null;
    note: string | null;
    by: { id: string; name: string };
  }[];
  suggestions: { id: string; name: string; reach: string | null; lastAskedOn: string | null; offers: number; askedHere: boolean }[];
  counts: { asked: number; quoted: number; waiting: number; late: number };
}

/** GET /orders/:id/defaults — what a step's row fills in from earlier orders and the quote. */
export interface OrderDefaults {
  forwarder: { name: string; refNo: string; why: "route" | "factory" } | null;
  banks: { customerBank: string | null; ourBank: string | null; refNo: string } | null;
  leadTime: { text: string; days: number | null; from: string; readyOn: string | null } | null;
  priceBasis: { basis: string; place: string | null } | null;
  /** A new shipment's ports, from the order's terms. */
  ports?: { portOfLoading: string | null; portOfDischarge: string | null };
  /** Ship-by while empty: when the customer wanted it. */
  shipBy?: { on: string; from: string } | null;
}
