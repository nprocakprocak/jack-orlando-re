// Desktop main process. Serves dist-www and either a game directory or a ZIP
// on 127.0.0.1. What the ZIP contains: README.md. The page is loaded over HTTP.
// This file does not import the engine.
//
// The port stays the same on every launch. The page stores options in localStorage
// and saves in IndexedDB, and both are tied to the full origin, port included.

import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const wwwRoot = path.join(path.dirname(scriptPath), "dist-www");

// Fixed so http://127.0.0.1:<port>/ is one origin across launches. A busy port
// ends the process; a random fallback would split the saved options and saves.
const PORT = 47821;

function fail(message) {
  console.error(message);
  process.exit(1);
  throw new Error(message);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Electron's executable and this script are not the game path. Flags are not either.
function userPathArgument(argv) {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--" || arg.startsWith("-")) continue;
    if (index === 0) continue;
    const base = path.basename(arg).toLowerCase();
    if (base === "electron" || base === "electron.exe") continue;
    if (samePath(arg, scriptPath)) continue;
    return arg;
  }
  return undefined;
}

// A directory, or a file whose name ends with .zip. Anything else is refused.
function readSource(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (st.isDirectory()) return "directory";
  if (st.isFile() && filePath.toLowerCase().endsWith(".zip")) return "zip";
  fail("Expected a directory or a .zip file.");
}

const rawPath = userPathArgument(process.argv);
if (!rawPath) fail("Pass a directory or a .zip file.");

const baseDir = process.env.INIT_CWD || process.cwd();
const targetPath = path.resolve(baseDir, rawPath);
const sourceType = readSource(targetPath);

// Direct path first. Otherwise each segment must match a real entry, exact spelling first.
// Same rules as locateGameFile in examples/play/vite.config.ts.
function locateGameFile(root, segments) {
  try {
    const direct = path.join(root, ...segments);
    if (fs.existsSync(direct)) return direct;
  } catch {
    return null;
  }
  let current = root;
  for (const segment of segments) {
    let names;
    try {
      names = fs.readdirSync(current);
    } catch {
      return null;
    }
    const match =
      names.find((name) => name === segment) ?? names.find((name) => name.toUpperCase() === segment.toUpperCase());
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

function within(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// Drop empty pieces. "." and ".." are refused before any join, so the raw URL is never
// passed to path.resolve(gameDir, rawRelative).
function urlSegments(reqUrl) {
  const pathOnly = (reqUrl ?? "/").split("?")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return { status: 400 };
  }
  const segments = decoded.split(/[\\/]/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) return { status: 403 };
  return { segments };
}

function text(res, status, body, method) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (method === "HEAD") res.end();
  else res.end(body);
}

function json(res, status, value, method) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (method === "HEAD") res.end();
  else res.end(body);
}

function sendFile(res, file, contentType, method) {
  const st = fs.statSync(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", st.size);
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on("error", () => {
    res.destroy();
  });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

const STATIC_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
  [".map", "application/json"],
]);

function serveStatic(res, segments, method) {
  const parts = segments.length === 0 ? ["index.html"] : segments;
  const file = path.join(wwwRoot, ...parts);
  if (!within(wwwRoot, file)) {
    text(res, 403, "Forbidden", method);
    return;
  }
  let realRoot;
  let realFile;
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      text(res, 404, "Not found", method);
      return;
    }
    realRoot = fs.realpathSync(wwwRoot);
    realFile = fs.realpathSync(file);
  } catch {
    text(res, 404, "Not found", method);
    return;
  }
  if (!within(realRoot, realFile)) {
    text(res, 403, "Forbidden", method);
    return;
  }
  const contentType = STATIC_TYPES.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";
  sendFile(res, realFile, contentType, method);
}

function serveGame(res, segments, method) {
  if (sourceType !== "directory") {
    text(res, 404, "Not found", method);
    return;
  }
  const file = locateGameFile(targetPath, segments);
  if (!file) {
    text(res, 404, "Not found", method);
    return;
  }
  if (!within(targetPath, file)) {
    text(res, 403, "Forbidden", method);
    return;
  }
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    text(res, 404, "Not found", method);
    return;
  }
  if (st.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(file, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        dir: entry.isDirectory(),
      }));
    } catch {
      text(res, 404, "Not found", method);
      return;
    }
    json(res, 200, entries, method);
    return;
  }
  if (!st.isFile()) {
    text(res, 404, "Not found", method);
    return;
  }
  sendFile(res, file, "application/octet-stream", method);
}

function handle(req, res) {
  const method = req.method ?? "GET";
  const parsed = urlSegments(req.url);
  if (parsed.status) {
    text(res, parsed.status, parsed.status === 403 ? "Forbidden" : "Bad request", method);
    return;
  }
  const segments = parsed.segments;
  const head = segments[0];

  if (segments.length === 1 && head === "quit") {
    if (method !== "POST") {
      text(res, 405, "Method not allowed", method);
      return;
    }
    res.statusCode = 204;
    res.end();
    setImmediate(() => {
      closeServer();
      app.quit();
    });
    return;
  }

  if (segments.length === 1 && head === "source.json") {
    if (method !== "GET" && method !== "HEAD") {
      text(res, 405, "Method not allowed", method);
      return;
    }
    json(res, 200, { type: sourceType }, method);
    return;
  }

  if (segments.length === 1 && head === "archive.zip") {
    if (sourceType !== "zip") {
      text(res, 404, "Not found", method);
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      text(res, 405, "Method not allowed", method);
      return;
    }
    sendFile(res, targetPath, "application/zip", method);
    return;
  }

  if (head === "game") {
    if (method !== "GET" && method !== "HEAD") {
      text(res, 405, "Method not allowed", method);
      return;
    }
    serveGame(res, segments.slice(1), method);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    text(res, 404, "Not found", method);
    return;
  }
  serveStatic(res, segments, method);
}

function listen() {
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      text(res, 500, "Server error", req.method ?? "GET");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

let server;

function closeServer() {
  if (!server) return;
  const current = server;
  server = null;
  current.close();
  if (typeof current.closeAllConnections === "function") current.closeAllConnections();
}

app.on("window-all-closed", () => {
  closeServer();
  app.quit();
});

app.whenReady().then(async () => {
  try {
    server = await listen();
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === "EADDRINUSE") {
      console.error(`127.0.0.1:${PORT} is already in use. Close the other window and start again.`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    app.exit(1);
    return;
  }
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1" || address.port !== PORT) {
    console.error("The server is not bound to 127.0.0.1.");
    closeServer();
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({
    width: 720,
    height: 600,
    backgroundColor: "#000000",
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.on("closed", () => {
    closeServer();
    app.quit();
  });
  try {
    await win.loadURL(`http://127.0.0.1:${address.port}/`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    closeServer();
    app.exit(1);
  }
});
