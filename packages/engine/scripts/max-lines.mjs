// Ceilings for TypeScript in this package. See .cursor/rules/engine-code.mdc.
// An implementation file may have 400 lines. A *.test.ts file may have 500.
// The count includes comments and blank lines.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const IMPLEMENTATION_LIMIT = 400;
export const TEST_LIMIT = 500;

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "dist-www"]);

// Files already over the limit. The number is the line count that file has now.
// Do not raise a number. Lower it when the file shrinks. Delete the entry at the limit.
const ALLOW = {
  "src/formats/global.ts": 507,
  "src/formats/media.ts": 583,
  "src/formats/scene.ts": 544,
  "src/formats/sound.ts": 470,
  "src/inventory/topbar.ts": 456,
  "src/mainmenu/menu.ts": 593,
  "src/persons/persons.ts": 536,
  "src/play/facewin.ts": 614,
  "src/play/game.test.ts": 856,
  "src/play/host.test.ts": 1010,
  "src/scene/player.test.ts": 502,
  "src/script/compiler.ts": 527,
  "src/script/interpreter.ts": 484,
  "src/sfx/sfx.test.ts": 564,
  "src/sfx/sfx.ts": 437,
};

/** @param {string} path */
function normalize(path) {
  return path.split("\\").join("/");
}

/** @param {string} text */
export function countLines(text) {
  if (text.length === 0) return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/** @param {string} path */
export function limitFor(path) {
  return normalize(path).endsWith(".test.ts") ? TEST_LIMIT : IMPLEMENTATION_LIMIT;
}

/**
 * @param {{ path: string, lines: number }[]} files
 * @param {Record<string, number>} exceptions
 * @returns {string[]}
 */
export function review(files, exceptions) {
  /** @type {Record<string, number>} */
  const allow = {};
  for (const [path, lines] of Object.entries(exceptions)) allow[normalize(path)] = lines;

  /** @type {string[]} */
  const errors = [];
  const seen = new Set();
  const sorted = [...files].sort((a, b) => normalize(a.path).localeCompare(normalize(b.path)));
  for (const file of sorted) {
    const path = normalize(file.path);
    seen.add(path);
    const limit = limitFor(path);
    const recorded = allow[path];
    if (recorded === undefined) {
      if (file.lines > limit) {
        errors.push(
          `${path} has ${file.lines} lines, over the limit of ${limit}. A new file over the limit does not pass.`,
        );
      }
      continue;
    }
    if (file.lines > recorded) {
      errors.push(
        `${path} has ${file.lines} lines. The exception list allows ${recorded}. A listed file cannot grow.`,
      );
    } else if (file.lines <= limit) {
      errors.push(
        `${path} has ${file.lines} lines, within the limit of ${limit}. Remove it from the exception list.`,
      );
    } else if (file.lines < recorded) {
      errors.push(
        `${path} has ${file.lines} lines. The exception list records ${recorded}. Lower the recorded count to ${file.lines}.`,
      );
    }
  }
  for (const path of Object.keys(allow).sort()) {
    if (!seen.has(path)) errors.push(`${path} is on the exception list and is not in the tree. Remove it.`);
  }
  return errors;
}

/** @param {string} dir @param {{ path: string, lines: number }[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push({ path, lines: countLines(readFileSync(path, "utf8")) });
  }
}

/** @returns {{ path: string, lines: number }[]} */
function collectFiles() {
  /** @type {{ path: string, lines: number }[]} */
  const files = [];
  walk(packageRoot, files);
  return files.map((file) => ({ path: normalize(relative(packageRoot, file.path)), lines: file.lines }));
}

/** @returns {string[]} */
export function checkPackage() {
  return review(collectFiles(), ALLOW);
}

/**
 * @param {string | undefined} entry
 * @param {string} url
 */
export function isDirectRun(entry = process.argv[1], url = import.meta.url) {
  if (!entry) return false;
  return url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  const errors = checkPackage();
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
}
