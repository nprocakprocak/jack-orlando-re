import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPackage, countLines, isDirectRun, limitFor, review } from "./max-lines.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("countLines", () => {
  it("counts a comment and a blank line, and ignores a trailing newline", () => {
    expect(countLines("const n = 1;\n\n// note\n")).toBe(3);
    expect(countLines("const n = 1;\n\n// note")).toBe(3);
    expect(countLines("")).toBe(0);
  });
});

describe("limitFor", () => {
  it("uses 400 for an implementation file and 500 for a test", () => {
    expect(limitFor("src/demo/widget.ts")).toBe(400);
    expect(limitFor("src/demo/widget.test.ts")).toBe(500);
  });
});

describe("review", () => {
  it("accepts a file at the limit", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 400 }])).toEqual([]);
    expect(review([{ path: "src/demo/widget.test.ts", lines: 500 }])).toEqual([]);
  });

  it("rejects a file over the limit", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 401 }])).toEqual([
      "src/demo/widget.ts has 401 lines, over the limit of 400.",
    ]);
    expect(review([{ path: "src/demo/widget.test.ts", lines: 501 }])).toEqual([
      "src/demo/widget.test.ts has 501 lines, over the limit of 500.",
    ]);
  });

  it("judges a Windows path by the same limit", () => {
    expect(review([{ path: "src\\demo\\widget.ts", lines: 400 }])).toEqual([]);
    expect(review([{ path: "src\\demo\\widget.test.ts", lines: 501 }])).toEqual([
      "src/demo/widget.test.ts has 501 lines, over the limit of 500.",
    ]);
  });
});

describe("max-lines command", () => {
  it("every file in the engine tree is within its limit", () => {
    expect(checkPackage()).toEqual([]);
  });

  it("treats this module as the entry when node runs the script", () => {
    const entry = resolve(packageRoot, "scripts/max-lines.mjs");
    const url = pathToFileURL(entry).href;
    expect(isDirectRun(entry, url)).toBe(true);
    expect(isDirectRun(resolve(packageRoot, "scripts/play-node.ts"), url)).toBe(false);
  });

  it("exits 0 for this package", () => {
    const result = spawnSync(process.execPath, ["scripts/max-lines.mjs"], {
      cwd: packageRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
