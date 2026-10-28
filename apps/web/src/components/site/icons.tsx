import {
  Bell,
  Calculator,
  ChartColumn,
  Clock,
  Factory,
  FileSpreadsheet,
  FileText,
  Globe,
  Inbox,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { SiteIcon } from "@kebo/shared";

/** The icons a feature block may use (the editor offers the same list). */
export const SITE_ICON: Record<SiteIcon, { icon: LucideIcon; label: string }> = {
  inbox: { icon: Inbox, label: "Inbox" },
  factory: { icon: Factory, label: "Factory" },
  calculator: { icon: Calculator, label: "Calculator" },
  "file-text": { icon: FileText, label: "Document" },
  truck: { icon: Truck, label: "Truck" },
  wallet: { icon: Wallet, label: "Wallet" },
  chart: { icon: ChartColumn, label: "Chart" },
  users: { icon: Users, label: "People" },
  shield: { icon: ShieldCheck, label: "Shield" },
  smartphone: { icon: Smartphone, label: "Phone" },
  sheet: { icon: FileSpreadsheet, label: "Spreadsheet" },
  globe: { icon: Globe, label: "Globe" },
  clock: { icon: Clock, label: "Clock" },
  bell: { icon: Bell, label: "Bell" },
};
