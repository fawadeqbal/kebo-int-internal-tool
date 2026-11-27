import "server-only";
import type { Metadata } from "next";
import { RECORD_TITLE } from "@kebo/shared";
import type { OrderView } from "./types-orders";
import { dealOf } from "./deal-data";
import { orderOf } from "./order-data";
import { customerOf, supplierOf } from "./party-data";

type Props = { params: Promise<{ id: string }> };

/**
 * A record's tab title: its name (the same title as its page, RECORD_TITLE: never its number), then the part, so open
 * tabs can be told apart ("Blister packing machine + 1 more · Supplier offers · RFQ Desk"). The record comes from the
 * same cached call as the page.
 */
export const titled = (name: string, part?: string): Metadata => ({ title: part ? `${name} · ${part}` : name });

/** An order's name (its page title and tab title). */
export const orderName = (o: OrderView) => RECORD_TITLE.order({ title: o.inquiry.title, items: o.lines.filter((l) => l.type === "goods"), customer: o.customer.name });
export const orderTitle = (part?: string) => async ({ params }: Props) => titled(orderName(await orderOf((await params).id)), part);
export const inquiryTitle = (part?: string) => async ({ params }: Props) => {
  const d = await dealOf((await params).id);
  return titled(RECORD_TITLE.inquiry({ title: d.title, items: d.items, customer: d.customer.name }), part);
};
export const customerTitle = (part?: string) => async ({ params }: Props) => titled((await customerOf((await params).id)).name, part);
export const supplierTitle = (part?: string) => async ({ params }: Props) => titled((await supplierOf((await params).id)).name, part);
