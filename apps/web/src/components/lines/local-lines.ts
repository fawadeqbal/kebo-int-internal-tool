import type { LineMove, LineResult, NewLine } from "./line-table";

/**
 * The line table's changes on a list kept in the page (a form saved as a
 * whole, like the inquiry), with the same rules the API uses for saved lines:
 * parts sit right after their line, a part cannot have parts, and moving a part
 * out takes the parts below it along so nothing jumps on screen.
 */
type Row = { key: string; parentKey: string | null };

const blockEnd = <T extends Row>(rows: T[], i: number) => {
  let j = i + 1;
  if (!rows[i]!.parentKey) while (j < rows.length && rows[j]!.parentKey === rows[i]!.key) j++;
  return j;
};

/** New rows after `afterKey` (and its parts, unless they join the same line), or at the end. */
export function insertLines<T extends Row>(rows: T[], fresh: T[], at: { afterKey: string | null; parentKey: string | null }): T[] {
  const after = at.afterKey ? rows.findIndex((r) => r.key === at.afterKey) : -1;
  let pos: number;
  if (at.parentKey) {
    const p = rows.findIndex((r) => r.key === at.parentKey);
    pos = after >= 0 && (rows[after]!.key === at.parentKey || rows[after]!.parentKey === at.parentKey) ? after + 1 : blockEnd(rows, p);
  } else if (after < 0) pos = rows.length;
  else {
    const top = rows[after]!.parentKey ? rows.findIndex((r) => r.key === rows[after]!.parentKey) : after;
    pos = blockEnd(rows, top);
  }
  return [...rows.slice(0, pos), ...fresh, ...rows.slice(pos)];
}

export function removeLine<T extends Row>(rows: T[], key: string): T[] {
  return rows.filter((r) => r.key !== key && r.parentKey !== key);
}

export function moveLine<T extends Row>(rows: T[], key: string, to: LineMove): T[] | string {
  const i = rows.findIndex((r) => r.key === key);
  const row = rows[i]!;
  if (to === "indent") {
    if (row.parentKey) return "It is a part already.";
    if (rows.some((r) => r.parentKey === key)) return "A line with parts cannot become a part. Move its parts out first.";
    const above = [...rows.slice(0, i)].reverse().find((r) => !r.parentKey);
    if (!above) return "There is no line above to make it a part of.";
    return rows.map((r, n) => (n === i ? { ...r, parentKey: above.key } : r));
  }
  if (to === "outdent") {
    if (!row.parentKey) return "It is not a part.";
    const old = row.parentKey;
    return rows.map((r, n) => (n === i ? { ...r, parentKey: null } : n > i && r.parentKey === old ? { ...r, parentKey: key } : r));
  }
  const by = to === "up" ? -1 : 1;
  if (row.parentKey) {
    const j = i + by;
    if (rows[j]?.parentKey !== row.parentKey) return to === "up" ? "It is the first part already." : "It is the last part already.";
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  }
  const tops = rows.map((r, n) => (r.parentKey ? -1 : n)).filter((n) => n >= 0);
  const other = tops[tops.indexOf(i) + by];
  if (other === undefined) return to === "up" ? "It is the first line already." : "It is the last line already.";
  const [a, b] = by < 0 ? [other, i] : [i, other];
  return [...rows.slice(0, a), ...rows.slice(b, blockEnd(rows, b)), ...rows.slice(a, blockEnd(rows, a)), ...rows.slice(blockEnd(rows, b))];
}

/** Line table handlers over a list in React state. `make` builds a row from typed values. */
export function localLineHandlers<T extends Row>(
  rows: T[],
  setRows: (fn: (rows: T[]) => T[]) => void,
  make: (values: Record<string, string>, parentKey: string | null) => T,
  patch: (row: T, values: Record<string, string>) => T,
) {
  const ok = (keys?: string[]): LineResult => ({ ok: true, keys });
  return {
    onAdd: async (lines: NewLine[], at: { afterKey: string | null; parentKey: string | null }) => {
      const fresh: T[] = [];
      for (const l of lines) fresh.push(make(l.values, at.parentKey ?? (l.partOf !== null ? fresh[l.partOf]!.key : null)));
      setRows((cur) => insertLines(cur, fresh, at));
      return ok(fresh.map((f) => f.key));
    },
    onEdit: async (key: string, values: Record<string, string>) => {
      setRows((cur) => cur.map((r) => (r.key === key ? patch(r, values) : r)));
      return ok();
    },
    onRemove: async (key: string) => {
      setRows((cur) => removeLine(cur, key));
      return ok();
    },
    onMove: async (key: string, to: LineMove): Promise<LineResult> => {
      const next = moveLine(rows, key, to);
      if (typeof next === "string") return { ok: false, message: next };
      setRows((cur) => {
        const moved = moveLine(cur, key, to);
        return typeof moved === "string" ? cur : moved;
      });
      return ok();
    },
  };
}
