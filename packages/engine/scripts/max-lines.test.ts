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
  const exceptions = { "src/demo/widget.ts": 450 };

  it("accepts a file at the limit and a listed file at its recorded count", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 450 }], exceptions)).toEqual([]);
    expect(review([{ path: "src/demo/other.ts", lines: 400 }], {})).toEqual([]);
    expect(review([{ path: "src/demo/other.test.ts", lines: 500 }], {})).toEqual([]);
  });

  it("rejects a new file over the limit", () => {
    expect(review([{ path: "src/demo/other.ts", lines: 401 }], {})).toEqual([
      "src/demo/other.ts has 401 lines, over the limit of 400. A new file over the limit does not pass.",
    ]);
    expect(review([{ path: "src/demo/other.test.ts", lines: 501 }], {})).toEqual([
      "src/demo/other.test.ts has 501 lines, over the limit of 500. A new file over the limit does not pass.",
    ]);
  });

  it("rejects growth of a listed file", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 451 }], exceptions)).toEqual([
      "src/demo/widget.ts has 451 lines. The exception list allows 450. A listed file cannot grow.",
    ]);
  });

  it("asks to lower the recorded count when a listed file shrinks and stays over the limit", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 420 }], exceptions)).toEqual([
      "src/demo/widget.ts has 420 lines. The exception list records 450. Lower the recorded count to 420.",
    ]);
  });

  it("asks to remove the entry when a listed file is within the limit", () => {
    expect(review([{ path: "src/demo/widget.ts", lines: 400 }], exceptions)).toEqual([
      "src/demo/widget.ts has 400 lines, within the limit of 400. Remove it from the exception list.",
    ]);
  });

  it("asks to remove an entry whose file is gone", () => {
    expect(review([{ path: "src/demo/other.ts", lines: 10 }], exceptions)).toEqual([
      "src/demo/widget.ts is on the exception list and is not in the tree. Remove it.",
    ]);
  });

  it("matches a Windows path to the exception list", () => {
    expect(review([{ path: "src\\demo\\widget.ts", lines: 450 }], exceptions)).toEqual([]);
  });
});

describe("max-lines command", () => {
  it("the engine tree matches the exception list", () => {
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
