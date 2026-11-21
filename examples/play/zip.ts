// A ZIP chosen on the page, turned into GameFiles.
//
// openZip inflates the whole archive in one synchronous call, and the tab
// stops painting until that call returns. This file does the same job in two
// steps the page can show:
//
// 1. Read the chosen file. FileReader reports how many bytes are in memory.
// 2. Unpack the archive in slices. Between slices the browser gets a turn,
//    so it can draw the progress line and accept another choice.
//
// A zip of a folder usually has one extra directory in front (Game/Global.pak,
// Game/Action/..., nothing beside that folder). The engine looks for Global.pak
// at the root of GameFiles, so that directory would hide the files. When it is
// the only top-level entry and it really holds Global.pak, reads are prefixed
// with its name. A file next to the folder, or a second folder, leaves the
// archive root as it is. Lookup is case-insensitive, as in openZip.

import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import type { GameFiles } from "jack-orlando-re";

// One push to the inflater. Large enough that the call overhead stays small,
// small enough that a single push returns before the tab feels stuck.
const SLICE = 256 * 1024;

// "read" is the FileReader filling an ArrayBuffer.
// "unpack" is compressed bytes handed to the inflater. Both are byte counts,
// so the bar under the file field can show either phase as a percent.
export type ZipPhase = "read" | "unpack";

// The engine's path check is not a public export, so the same rules live here.
// Backslashes become slashes. A leading "./" or "/" is the archive root, not
// a directory named that. ".." , a drive letter, or an empty path would escape
// the archive or name nothing, so they are dropped instead of indexed.
function normalizeRel(rel: string): string | null {
  let path = rel.replace(/\\/g, "/");
  if (path.startsWith("./")) path = path.slice(2);
  if (path.startsWith("/")) path = path.slice(1);
  if (path === "" || /^[a-zA-Z]:/.test(path) || path.startsWith("//")) return null;
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null;
  return segments.join("/");
}

// The one top-level directory to step into, or null when the archive root is
// already the game root. A real file sitting next to that directory (not a
// "Name/" marker) means the root is the game. A second directory does too.
// ".." anywhere is refused: guessing a root past that would be wrong.
function soleTopDirectory(names: readonly string[]): string | null {
  const tops = new Set<string>();
  for (const raw of names) {
    const slash = raw.replace(/\\/g, "/");
    const parts = slash.replace(/^\/+/, "").split("/").filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    if (parts.some((part) => part === "." || part === "..")) return null;
    const isDirectory = slash.endsWith("/");
    if (!isDirectory && parts.length === 1) return null;
    tops.add(parts[0]);
    if (tops.size > 1) return null;
  }
  if (tops.size !== 1) return null;
  return [...tops][0];
}

// fflate delivers one file as a series of chunks. One chunk that already owns
// its buffer is the file. A view into a larger buffer, or several chunks, is
// copied into one array so the indexed file does not keep the spare bytes.
function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0].byteOffset === 0) return parts[0];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// A macrotask, not a microtask. queueMicrotask would run the next slice before
// the browser paints, and the progress line would jump to the end.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// arrayBuffer() has no progress events. FileReader does, which is the "Reading"
// half of the bar. Some browsers skip onprogress for a local file and only
// fire onload, so onload reports the full size as well. Abort stops the read
// and rejects; the caller treats that as "the user picked another file".
function readFile(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      return;
    }
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    reader.onload = () => {
      signal.removeEventListener("abort", abort);
      onProgress(file.size, file.size);
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(reader.error ?? new Error("Could not read the ZIP"));
    };
    reader.readAsArrayBuffer(file);
  });
}

// fflate's Unzip is a stream of local file headers, not "inflate this buffer".
// Each push feeds the next slice. When a header is complete, onfile runs:
// ondata must be set before start(), or fflate throws. start() begins that
// file; its bytes may still arrive in later slices, so the file stays in
// `pending` until ondata says final.
//
// Unzip on its own only understands stored files (method 0). register adds
// deflate, which is what a normal ZIP uses.
//
// ondata's buffer is only valid until the next push, so each chunk is copied.
// A name ending in "/" is a directory marker: it is consumed so the stream
// stays aligned, and it is not stored as a file.
//
// The last slice is pushed with final = true. That is how fflate knows the
// central directory at the end of the archive is the end, not another file.
// If anything is still pending after that, the archive was cut off.
async function unpackZip(
  bytes: Uint8Array,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const pending = new Map<string, Uint8Array[]>();
  let failed: Error | null = null;

  const unzipper = new Unzip((file: UnzipFile) => {
    const parts: Uint8Array[] = [];
    pending.set(file.name, parts);
    file.ondata = (err, data, final) => {
      if (err) {
        failed = err instanceof Error ? err : new Error(String(err));
        return;
      }
      if (data?.length) parts.push(data.slice());
      if (!final) return;
      pending.delete(file.name);
      if (!file.name.endsWith("/")) files.set(file.name, concat(parts));
    };
    try {
      file.start();
    } catch (err) {
      failed = err instanceof Error ? err : new Error(String(err));
    }
  });
  unzipper.register(UnzipInflate);

  const total = bytes.length;
  for (let offset = 0; offset < total; ) {
    if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    const next = Math.min(offset + SLICE, total);
    unzipper.push(bytes.subarray(offset, next), next === total);
    if (failed) throw failed;
    offset = next;
    onProgress(offset, total);
    if (offset < total) await yieldToBrowser();
  }
  if (pending.size > 0) throw new Error("ZIP ended before every file was unpacked");
  return files;
}

// Case-insensitive index, same rule as openZip. Two entries that differ only
// by case: the spelling that matches the request wins, otherwise the first.
// A path normalizeRel rejects is left out of the index. read() copies, so a
// caller can change the bytes without changing the indexed file.
function gameFiles(entries: Map<string, Uint8Array>): GameFiles {
  const byUpper = new Map<string, { path: string; data: Uint8Array }[]>();
  for (const [name, data] of entries) {
    const path = normalizeRel(name);
    if (!path) continue;
    const list = byUpper.get(path.toUpperCase()) ?? [];
    list.push({ path, data });
    byUpper.set(path.toUpperCase(), list);
  }
  const resolve = (rel: string) => {
    const path = normalizeRel(rel);
    if (!path) return undefined;
    const list = byUpper.get(path.toUpperCase());
    if (!list?.length) return undefined;
    return list.find((entry) => entry.path === path) ?? list[0];
  };
  return {
    async read(rel) {
      const entry = resolve(rel);
      if (!entry) throw new Error(`File not found: ${rel}`);
      return new Uint8Array(entry.data);
    },
    async exists(rel) {
      return resolve(rel) !== undefined;
    },
  };
}

// The engine asks for "Global.pak". Under a stepped-into folder that read
// becomes "<root>/Global.pak". exists is optional on GameFiles; this wrapper
// always has it, and answers false when the inner source does not.
function withRoot(files: GameFiles, root: string): GameFiles {
  const at = (rel: string) => `${root}/${rel.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return {
    read: (rel) => files.read(at(rel)),
    exists: (rel) => files.exists?.(at(rel)) ?? Promise.resolve(false),
  };
}

// Abort is not a failure to show. It means a newer choice replaced this one.
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Bytes already in memory. `onProgress` is unpack progress, in bytes of the archive. */
export async function filesFromZipBytes(
  bytes: Uint8Array,
  onProgress: (loaded: number, total: number) => void = () => undefined,
  signal: AbortSignal = new AbortController().signal,
): Promise<GameFiles> {
  const entries = await unpackZip(bytes, onProgress, signal);
  const files = gameFiles(entries);
  // Step into the single top directory only when it actually holds the game.
  // Otherwise keep the archive root and let the player report the real miss.
  const root = soleTopDirectory([...entries.keys()]);
  if (!root) return files;
  const nested = withRoot(files, root);
  if (await nested.exists?.("Global.pak")) return nested;
  return files;
}

/**
 * The file from the page's ZIP field.
 * `onProgress` runs for the read, then again for the unpack. `loaded` / `total`
 * start over at the unpack, because they count a different thing.
 */
export async function filesFromZip(
  file: File,
  onProgress: (phase: ZipPhase, loaded: number, total: number) => void = () => undefined,
  signal: AbortSignal = new AbortController().signal,
): Promise<GameFiles> {
  const bytes = await readFile(file, (loaded, total) => onProgress("read", loaded, total), signal);
  return filesFromZipBytes(bytes, (loaded, total) => onProgress("unpack", loaded, total), signal);
}

// Called only when /game/ has no game files. Reveals #info and #zip-box from
// index.html. The progress line under the file field stays hidden until a
// file is chosen.
//
// Each choice aborts the previous read or unpack. The aborted call rejects;
// that rejection is ignored, and the input stays disabled until the choice
// that is still current finishes. A real error (bad zip, truncated archive)
// is handed to onError, which the page writes into #info.
export function showZipFallback(
  onFiles: (files: GameFiles) => Promise<void>,
  onError: (message: string) => void,
): void {
  const info = document.getElementById("info");
  const box = document.getElementById("zip-box");
  const input = document.getElementById("zip");
  const progress = document.getElementById("zip-progress");
  if (!(info instanceof HTMLElement) || !(box instanceof HTMLElement)) return;
  if (!(input instanceof HTMLInputElement) || !(progress instanceof HTMLElement)) return;
  const bar = progress.querySelector("progress");
  const label = progress.querySelector("span");
  if (!(bar instanceof HTMLProgressElement) || !(label instanceof HTMLElement)) return;

  info.hidden = false;
  box.hidden = false;

  let current: AbortController | null = null;

  const showProgress = (text: string, loaded: number, total: number) => {
    progress.hidden = false;
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    bar.value = pct;
    label.textContent = `${text} ${pct}%`;
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    current?.abort();
    const controller = new AbortController();
    current = controller;
    input.disabled = true;
    showProgress("Reading ZIP…", 0, 1);
    void filesFromZip(file, (phase, loaded, total) => {
      if (controller.signal.aborted) return;
      showProgress(phase === "read" ? "Reading ZIP…" : "Unpacking ZIP…", loaded, total);
    }, controller.signal)
      .then((files) => {
        if (controller.signal.aborted) return;
        progress.hidden = true;
        return onFiles(files);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        progress.hidden = true;
        onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (current === controller) input.disabled = false;
      });
  });
}
