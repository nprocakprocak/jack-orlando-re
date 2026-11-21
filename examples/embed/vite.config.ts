// Embed example. Resolves jack-orlando-browser and jack-orlando-re through
// package exports (dist), like an outside project would.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..");

export default defineConfig({
  root: packageRoot,
  server: {
    open: "/",
  },
});
