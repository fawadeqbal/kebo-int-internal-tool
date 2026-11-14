/**
 * Dev tools (platform admin): what the API sends, what the web shows. Levels: ok = fine,
 * warn = needs you this week, bad = needs you now, off = not set up or not checked.
 */
export type DevLevel = "ok" | "warn" | "bad" | "off";
export type DevTab = "picture" | "services" | "data" | "speed" | "jobs" | "security" | "companies";
/** The map's columns, in the order a request travels. */
export const DEV_LANES = [
  { key: "addresses", label: "Addresses" },
  { key: "server", label: "Server" },
  { key: "app", label: "App" },
  { key: "data", label: "Data" },
  { key: "outside", label: "Outside services" },
] as const;
export type DevLane = (typeof DEV_LANES)[number]["key"];

export interface DevCheck {
  key: string;
  lane: DevLane;
  name: string;
  /** One line: what it is now ("81% full · 19 GB free"). */
  line: string;
  level: DevLevel;
  tab: DevTab;
  /** What to do, when it needs you. */
  fix?: string;
}

export interface DevService {
  key: string;
  label: string;
  role: string;
  state: string;
  level: DevLevel;
  status: string;
  startedAt: string | null;
  restarts: number;
  restarts24h: number;
  lastRestart: { at: string; why: string } | null;
  cpu: number | null;
  memMb: number | null;
  memLimitMb: number | null;
  hasLog: boolean;
}

export interface DevEvent {
  at: string;
  kind: "deploy" | "deployFailed" | "restart" | "stopped" | "warning" | "backup" | "backupFailed" | "error";
  level: DevLevel;
  text: string;
}

export interface DevDeploy {
  at: string;
  commit: string;
  title: string;
  ok: boolean;
}

export interface DevOverview {
  /** When the API answered (the page's "now"). */
  now: string;
  /** When the server last wrote its status; null: never (not set up). */
  checkedAt: string | null;
  stale: boolean;
  checks: DevCheck[];
  tiles: {
    cpu: number | null;
    load: number | null;
    cores: number | null;
    memory: { usedMb: number; totalMb: number; percent: number } | null;
    disk: { usedGb: number; totalGb: number; freeGb: number; percent: number } | null;
    backupAt: string | null;
    backupLevel: DevLevel;
    services: { running: number; all: number };
    /** Last 24 hours: half answered faster than typicalMs; all but the slowest 5% faster than slowMs. */
    typicalMs: number | null;
    slowMs: number | null;
    requests24h: number;
    errors24h: number;
    /** The API answered the server's own check, share of the minutes in the last 7 days. */
    upPercent: number | null;
    lastDown: string | null;
  };
  host: { os: string | null; uptimeSec: number | null; docker: string | null } | null;
  deploys: DevDeploy[];
  events: DevEvent[];
  /** CPU and memory, last 24 hours, every 15 minutes. */
  chart: { t: string; cpu: number | null; mem: number | null }[];
}

export interface DevServicesView {
  checkedAt: string | null;
  services: DevService[];
  /** Services with a live log. */
  logs: string[];
  /** Live logs are set up (the folder is mounted). */
  logsOn: boolean;
}

export interface DevDataView {
  checkedAt: string | null;
  disk: { usedGb: number; totalGb: number; freeGb: number; percent: number } | null;
  /** At the growth of the last 14 days; null: not growing (or not known yet). */
  fullInDays: number | null;
  growthGbPerDay: number | null;
  space: { key: string; label: string; gb: number }[];
  spaceAt: string | null;
  days: { day: string; percent: number; usedGb: number }[];
  backup: {
    level: DevLevel;
    lastGoodAt: string | null;
    lastTryAt: string | null;
    ok: boolean | null;
    message: string | null;
    dump: string | null;
    offsite: "off" | "ok" | "failed" | null;
  };
  database: {
    ok: boolean;
    version: string | null;
    sizeMb: number | null;
    connections: number | null;
    maxConnections: number | null;
    cacheHit: number | null;
    longestQuerySec: number | null;
    tables: { name: string; rows: number; mb: number }[];
  };
}

export interface DevError {
  id: string;
  source: string;
  name: string;
  message: string;
  where: string;
  stack: string | null;
  count: number;
  companyName: string | null;
  userName: string | null;
  path: string | null;
  firstAt: string;
  lastAt: string;
  status: "open" | "fixed";
  /** The deploy it first came after (a hint at what caused it). */
  afterDeploy: string | null;
}

export interface DevRoute {
  route: string;
  count: number;
  errors: number;
  typicalMs: number | null;
  slowMs: number | null;
}

export interface DevSpeedView {
  range: "24h" | "7d";
  requests: number;
  errors: number;
  typicalMs: number | null;
  slowMs: number | null;
  upPercent: number | null;
  /** Every hour (24h) or every 6 hours (7d). */
  chart: { t: string; count: number; typicalMs: number | null; slowMs: number | null }[];
  slowest: DevRoute[];
  errorsList: DevError[];
  fixedCount: number;
  outside: { lastAt: string | null; checks24h: number };
}

export interface DevJob {
  key: string;
  label: string;
  /** Who runs it: the app's worker, or the server. */
  by: "worker" | "server";
  schedule: string;
  lastAt: string | null;
  tookMs: number | null;
  ok: boolean | null;
  result: string | null;
  level: DevLevel;
  /** Failed runs in the last 7 days. */
  failed7d: number;
}

export interface DevDeliveryFailure {
  at: string;
  channel: "email" | "push" | string;
  what: string;
  to: string | null;
  companyName: string | null;
  reason: string;
}

export interface DevJobsView {
  jobs: DevJob[];
  email: { today: { sent: number; failed: number }; days: { day: string; sent: number; failed: number }[] };
  push: { today: { sent: number; failed: number }; days: { day: string; sent: number; failed: number }[]; phones: number };
  failures: DevDeliveryFailure[];
  /** When the platform admins get an email, and how it stands now. */
  limits: { label: string; now: string; level: DevLevel }[];
}

export interface DevSecurityView {
  signIns: {
    ok24h: number;
    failed24h: number;
    blocked24h: number;
    rows: { result: string; who: string; company: string | null; ip: string; times: number; lastAt: string; level: DevLevel }[];
  };
  platformAdmins: { all: number; withTwoStep: number; locked: number };
  users: { all: number; withoutTwoStep: number; managersWithout: number };
  withoutTwoStep: { company: string; users: number; of: number; managers: number }[];
  server: {
    checkedAt: string | null;
    updates: { all: number; security: number; reboot: boolean | null } | null;
    ports: number[] | null;
    firewall: "on" | "off" | null;
    sshPassword: boolean | null;
    certificates: { host: string; ok: boolean; endsAt?: string; error?: string }[];
  };
  checks: DevCheck[];
}

export interface DevCompany {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  plan: string | null;
  endsAt: string | null;
  users: number;
  usedThisWeek: number;
  lastUsedAt: string | null;
  errors7d: number;
  filesMb: number;
  orders: number;
  level: DevLevel;
  note: string;
}

export interface DevCompaniesView {
  companies: DevCompany[];
  /** All companies: requests by hour of the day (the server's time zone), last 7 days. */
  busyHours: number[];
}

export interface DevLogLine {
  at: string | null;
  text: string;
  level: "error" | "warn" | null;
}

export interface DevLogs {
  service: string;
  lines: DevLogLine[];
  /** Ask again with after=next for the lines written since. */
  next: number;
  missing: boolean;
}

/** "3 min ago", "5 hours ago", "2 days ago". */
export function agoText(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "never";
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** "6 days", "5 hours", "12 min". */
export function forText(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 48 * 3600) return `${Math.round(sec / 3600)} hours`;
  return `${Math.round(sec / 86400)} days`;
}
