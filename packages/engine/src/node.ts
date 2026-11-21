import fs from "node:fs";
import path from "node:path";
import { parseRelPath } from "./files/paths";
import { openZip, type GameFiles } from "./index";

export * from "./index";

// A case-sensitive disk (Linux, or a case-sensitive macOS volume) stores
// whatever spelling the copy has. The engine asks for one spelling, for
// example Global.pak. Windows and a normal macOS disk already fold case, so
// the direct path hits. When it does not, walk each segment and take the
// directory entry with the same letters. An exact spelling wins over another
// entry that differs only by case.
function locateFile(root: string, segments: readonly string[], listed: Map<string, string[]>): string | null {
  const direct = path.join(root, ...segments);
  if (fs.existsSync(direct)) return direct;
  let current = root;
  for (const segment of segments) {
    let names = listed.get(current);
    if (!names) {
      try {
        names = fs.readdirSync(current);
      } catch {
        return null;
      }
      listed.set(current, names);
    }
    const match =
      names.find((name) => name === segment) ?? names.find((name) => name.toUpperCase() === segment.toUpperCase());
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

/** Game assets from a directory on disk (Node only). Lookup ignores case. */
export function openDirectory(dir: string): GameFiles {
  const listed = new Map<string, string[]>();
  const foundAt = (rel: string): { path: string; file: boolean } | null => {
    const parsed = parseRelPath(rel);
    if (!parsed.ok) return null;
    const found = locateFile(dir, parsed.segments, listed);
    if (!found) return null;
    try {
      return { path: found, file: fs.statSync(found).isFile() };
    } catch {
      return null;
    }
  };
  return {
    async read(rel) {
      if (!parseRelPath(rel).ok) throw new Error(`Invalid path: ${rel}`);
      const found = foundAt(rel);
      if (!found) throw new Error(`File not found: ${rel}`);
      if (!found.file) throw new Error(`Not a file: ${rel}`);
      return new Uint8Array(fs.readFileSync(found.path));
    },
    async exists(rel) {
      return foundAt(rel)?.file === true;
    },
  };
}

/** Game assets from a ZIP file on disk (Node only). What to pack: README.md. */
export async function openZipFile(zipPath: string): Promise<GameFiles> {
  const bytes = new Uint8Array(await fs.promises.readFile(zipPath));
  return openZip(bytes);
}
