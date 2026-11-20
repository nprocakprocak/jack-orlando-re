/** Decimal text of `n`, at least two digits wide. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
