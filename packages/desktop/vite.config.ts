// Builds the boot page into dist-www. Imports resolve through package exports
// (dist), and Vite bundles them into the page. A static server cannot resolve
// workspace imports at runtime.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..");

export default defineConfig({
  root: packageRoot,
  build: {
    outDir: "dist-www",
    emptyOutDir: true,
  },
});
