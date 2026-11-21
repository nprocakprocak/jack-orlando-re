/** Normalize `\` to `/`, strip one leading `./` or `/`, split into segments. */
export function parseRelPath(rel: string): { ok: true; segments: string[]; path: string } | { ok: false } {
  let p = rel.replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);
  if (p === "") return { ok: false };
  if (/^[a-zA-Z]:/.test(p) || p.startsWith("//")) return { ok: false };
  const segments = p.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false };
  if (segments.some((s) => s === "..")) return { ok: false };
  return { ok: true, segments, path: segments.join("/") };
}