/** Local slug normalization shared by studio server helpers. Mirrors the
 * engine's normalizeLetters but lives app-side so we don't leak domain code. */
export function normalizeLetters(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z]/g, "");
}
