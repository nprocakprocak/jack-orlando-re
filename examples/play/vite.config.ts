// Dev server for this page. `npm run dev` at the repo root runs it.
//
// JO_GAME_DIR, when set in the environment, is a directory of game files.
// The middleware exposes that directory at /game/ so main.ts can fetch
// Global.pak without a ZIP. The directory is not inside this repository.
// Leave the variable unset and the middleware does nothing; use the ZIP field.
// What that ZIP contains: README.md.
//
// The aliases point package imports at TypeScript source. A consumer who
// installed jack-orlando-re and jack-orlando-browser from npm does not need
// them: their bundler resolves the published dist. They exist here so this
// page runs without building the packages first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = path.resolve(packageRoot, "../..");

// Direct path first (Windows and a normal macOS disk already fold case).
// Otherwise each segment must match a real entry, exact spelling first.
function locateGameFile(root: string, segments: readonly string[]): string | null {
  const direct = path.join(root, ...segments);
  if (fs.existsSync(direct)) return direct;
  let current = root;
  for (const segment of segments) {
    let names: string[];
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

function serveGameDir(): Plugin {
  return {
    name: "serve-game-dir",
    configureServer(server) {
      const gameDir = process.env.JO_GAME_DIR;
      if (!gameDir) return;
      const rootDir = path.resolve(gameDir);
      server.middlewares.use("/game", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        // Segments only. ".." never becomes a path.resolve escape, and a
        // request is matched to the real directory entry without regard to
        // case, the same way openDirectory does. Linux keeps the spelling of
        // a Windows copy; Global.pak still finds GLOBAL.PAK.
        const segments = rel.split(/[\\/]/).filter((segment) => segment.length > 0);
        if (segments.some((segment) => segment === "." || segment === "..")) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const file = locateGameFile(rootDir, segments);
        if (!file) {
          next();
          return;
        }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
          const entries = fs.readdirSync(file, { withFileTypes: true }).map((e) => ({
            name: e.name,
            dir: e.isDirectory(),
          }));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(entries));
          return;
        }
        if (!fs.existsSync(file)) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: packageRoot,
  plugins: [serveGameDir()],
  resolve: {
    alias: [
      // Exact package names, not prefixes. jack-orlando-re/node is a file,
      // not a folder, so it is listed before the <name>/index.ts pattern.
      {
        find: "jack-orlando-browser",
        replacement: path.join(repoRoot, "packages/browser/src/index.ts"),
      },
      {
        find: "jack-orlando-re/node",
        replacement: path.join(repoRoot, "packages/engine/src/node.ts"),
      },
      {
        find: /^jack-orlando-re\/(.+)$/,
        replacement: path.join(repoRoot, "packages/engine/src/$1/index.ts"),
      },
      {
        find: /^jack-orlando-re$/,
        replacement: path.join(repoRoot, "packages/engine/src/index.ts"),
      },
    ],
  },
  server: {
    open: "/",
  },
});
