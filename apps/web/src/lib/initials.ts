/** Up to two letters for the company's tile: "Kebo International" → "KI", "Acme" → "AC". */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "K";
}
