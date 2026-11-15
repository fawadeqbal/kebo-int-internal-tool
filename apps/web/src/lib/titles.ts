import "server-only";
import type { Metadata } from "next";
import { dealOf } from "./deal-data";
import { orderOf } from "./order-data";
import { customerOf, factoryOf } from "./party-data";

type Props = { params: Promise<{ id: string }> };

/**
 * A record's tab title: its number or name first, then the part, so open tabs can be told apart
 * ("RFQ-2026-0654 · Factory offers · RFQ Desk"). The record comes from the same cached call as the page.
 */
export const titled = (name: string, part?: string): Metadata => ({ title: part ? `${name} · ${part}` : name });

export const orderTitle = (part?: string) => async ({ params }: Props) => titled((await orderOf((await params).id)).refNo, part);
export const inquiryTitle = (part?: string) => async ({ params }: Props) => titled((await dealOf((await params).id)).refNo, part);
export const customerTitle = (part?: string) => async ({ params }: Props) => titled((await customerOf((await params).id)).name, part);
export const supplierTitle = (part?: string) => async ({ params }: Props) => titled((await factoryOf((await params).id)).name, part);
