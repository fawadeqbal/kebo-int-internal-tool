import type { LineColumn } from "./line-table";

/** The customer's items as the line table shows them (the inquiry's Items step, and its read-only views). */
export const ITEM_COLUMNS: LineColumn[] = [
  { key: "description", label: "Description", width: "minmax(0,1fr)", input: "textarea", required: "Each item needs a description" },
  { key: "model", label: "Model / part no.", width: "8rem", input: "text", maxLength: 120, placeholder: "Model" },
  {
    key: "quantity",
    label: "Quantity",
    width: "5rem",
    input: "number",
    align: "right",
    required: "Enter a quantity",
    placeholder: "Quantity",
  },
  { key: "unit", label: "Unit", width: "5.5rem", input: "unit", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
  { key: "targetPrice", label: "Target price", width: "6.5rem", input: "number", align: "right", placeholder: "Target", phoneHidden: true },
];
