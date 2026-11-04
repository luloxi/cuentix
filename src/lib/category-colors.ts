/** Stable color palette for category chart lines / legend. */
const PALETTE = [
  "var(--cat-1)", // emerald
  "var(--cat-2)", // blue
  "var(--cat-3)", // amber
  "var(--cat-4)", // pink
  "var(--cat-5)", // violet
  "var(--cat-6)", // cyan
  "var(--cat-7)", // red
  "var(--cat-8)", // lime
  "var(--cat-9)", // orange
  "var(--cat-10)", // indigo
  "var(--cat-11)", // teal
  "var(--cat-12)", // fuchsia
  "var(--cat-13)", // slate
];

export function colorForCategory(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length]!;
}

/** Fondo suave del color de una categoría (los colores son variables CSS, no hex). */
export function tint(color: string, percent = 14): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
