/**
 * How many items still need a price (canvas "From the supplier offer to the quotation", change 1; design rule 7):
 * an item counts when it has no price and none of its parts has one either. A part never counts on its own: it is
 * priced in its item (an item priced as a whole, its parts listed under it).
 */
export function unpricedItems(lines: readonly { id: string; parentId: string | null; price: number | string }[]): number {
  const priced = (l: { price: number | string }) => Number(l.price) > 0;
  return lines.filter((l) => !l.parentId && !priced(l) && !lines.some((p) => p.parentId === l.id && priced(p))).length;
}
