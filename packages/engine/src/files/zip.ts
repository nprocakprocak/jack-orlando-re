import { unzipSync } from "fflate";
import { parseRelPath } from "./paths";
import type { GameFiles } from "../play/game";

interface IndexedEntry {
  /** Normalized path keeping archive entry casing. */
  path: string;
  data: Uint8Array;
}

function indexZip(bytes: Uint8Array): Map<string, IndexedEntry[]> {
  const raw = unzipSync(bytes);
  const byUpper = new Map<string, IndexedEntry[]>();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith("/")) continue;
    const parsed = parseRelPath(name);
    if (!parsed.ok) continue;
    const entry: IndexedEntry = { path: parsed.path, data: new Uint8Array(data) };
    const upper = parsed.path.toUpperCase();
    const list = byUpper.get(upper) ?? [];
    list.push(entry);
    byUpper.set(upper, list);
  }
  return byUpper;
}

function resolveEntry(byUpper: Map<string, IndexedEntry[]>, rel: string): IndexedEntry | undefined {
  const parsed = parseRelPath(rel);
  if (!parsed.ok) return undefined;
  const list = byUpper.get(parsed.path.toUpperCase());
  if (!list?.length) return undefined;
  const exact = list.find((e) => e.path === parsed.path);
  return exact ?? list[0];
}

/** Game assets from an in-memory ZIP (browser and Node). What to pack: README.md. */
export function openZip(bytes: Uint8Array): GameFiles {
  const index = indexZip(bytes);
  return {
    async read(rel) {
      const entry = resolveEntry(index, rel);
      if (!entry) throw new Error(`File not found: ${rel}`);
      return new Uint8Array(entry.data);
    },
    async exists(rel) {
      return resolveEntry(index, rel) !== undefined;
    },
  };
}