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
 * @returns {string[]}
 */
export function review(files) {
  /** @type {string[]} */
  const errors = [];
  const sorted = [...files].sort((a, b) => normalize(a.path).localeCompare(normalize(b.path)));
  for (const file of sorted) {
    const path = normalize(file.path);
    const limit = limitFor(path);
    if (file.lines > limit) errors.push(`${path} has ${file.lines} lines, over the limit of ${limit}.`);
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
  return review(collectFiles());
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
