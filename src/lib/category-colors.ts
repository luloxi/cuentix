/** Stable color palette for category chart lines / legend. */
const PALETTE = [
  "#059669", // emerald
  "#2563eb", // blue
  "#d97706", // amber
  "#db2777", // pink
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#dc2626", // red
  "#65a30d", // lime
  "#ea580c", // orange
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#c026d3", // fuchsia
  "#64748b", // slate
];

export function colorForCategory(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length]!;
}
