import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { openZip } from "./zip";
import { openDirectory, openZipFile } from "../node";

const GLOBAL_BYTES = Uint8Array.of(1, 2, 3);
const ACTION_BYTES = Uint8Array.of(4, 5, 6, 7);
const MARKER = "marker";

function buildFixtureZip(opts?: { actionKey?: string }) {
  const actionKey = opts?.actionKey ?? "Action/SC001.PHK";
  return zipSync({
    "Global.pak": GLOBAL_BYTES,
    [actionKey]: ACTION_BYTES,
    "notes.txt": new TextEncoder().encode(MARKER),
  });
}

describe("game file access from zip and directory", () => {
  let tempRoot = "";

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  function makeTempDir(): string {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jo-files-"));
    return tempRoot;
  }

  function writeFixtureDir(root: string) {
    fs.mkdirSync(path.join(root, "Action"), { recursive: true });
    fs.writeFileSync(path.join(root, "Global.pak"), GLOBAL_BYTES);
    fs.writeFileSync(path.join(root, "Action", "SC001.PHK"), ACTION_BYTES);
    fs.writeFileSync(path.join(root, "notes.txt"), MARKER);
  }

  it("openZip reads Global.pak and Action/SC001.PHK", async () => {
    const files = openZip(buildFixtureZip());
    expect(new Uint8Array(await files.read("Global.pak"))).toEqual(GLOBAL_BYTES);
    expect(new Uint8Array(await files.read("Action/SC001.PHK"))).toEqual(ACTION_BYTES);
  });

  it("finds zip entries stored with backslashes", async () => {
    const files = openZip(buildFixtureZip({ actionKey: "Action\\SC001.PHK" }));
    expect(new Uint8Array(await files.read("Action/SC001.PHK"))).toEqual(ACTION_BYTES);
  });

  it("lookup is case-insensitive", async () => {
    const files = openZip(buildFixtureZip());
    expect(await files.exists!("global.PAK")).toBe(true);
    expect(new Uint8Array(await files.read("global.PAK"))).toEqual(GLOBAL_BYTES);
  });

  it("rejects missing files", async () => {
    const files = openZip(buildFixtureZip());
    expect(await files.exists!("Resource/MISSING.PAK")).toBe(false);
    await expect(files.read("Resource/MISSING.PAK")).rejects.toThrow();
  });

  it("rejects paths that escape or are invalid", async () => {
    const files = openZip(buildFixtureZip());
    for (const bad of ["../notes.txt", "C:/notes.txt", "", "Action/../notes.txt"]) {
      expect(await files.exists!(bad)).toBe(false);
      await expect(files.read(bad)).rejects.toThrow();
    }
    expect(await files.exists!("notes.txt")).toBe(true);
  });

  it("openDirectory finds a different case on disk", async () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "action"));
    fs.writeFileSync(path.join(dir, "global.PAK"), GLOBAL_BYTES);
    fs.writeFileSync(path.join(dir, "action", "sc001.phk"), ACTION_BYTES);
    const files = openDirectory(dir);
    expect(new Uint8Array(await files.read("Global.pak"))).toEqual(GLOBAL_BYTES);
    expect(new Uint8Array(await files.read("Action/SC001.PHK"))).toEqual(ACTION_BYTES);
    expect(await files.exists!("GLOBAL.pak")).toBe(true);
    expect(await files.exists!("missing.pak")).toBe(false);
  });

  it("openDirectory reads the same layout", async () => {
    const dir = makeTempDir();
    writeFixtureDir(dir);
    const files = openDirectory(dir);
    expect(new Uint8Array(await files.read("Global.pak"))).toEqual(GLOBAL_BYTES);
    expect(new Uint8Array(await files.read("Action/SC001.PHK"))).toEqual(ACTION_BYTES);
    expect(await files.exists!("global.PAK")).toBe(true);
    expect(await files.exists!(dir)).toBe(false);
    await expect(files.read(dir)).rejects.toThrow();
  });

  it("openZipFile reads a zip written to disk", async () => {
    const dir = makeTempDir();
    const zipPath = path.join(dir, "game.zip");
    fs.writeFileSync(zipPath, buildFixtureZip());
    const files = await openZipFile(zipPath);
    expect(new Uint8Array(await files.read("Global.pak"))).toEqual(GLOBAL_BYTES);
  });

  it("returned bytes are not shared with the cache", async () => {
    const files = openZip(buildFixtureZip());
    const a = await files.read("Global.pak");
    a[0] = 99;
    const b = await files.read("Global.pak");
    expect(b[0]).toBe(1);
  });
});
