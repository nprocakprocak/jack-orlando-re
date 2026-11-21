import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");

export default defineConfig({
  resolve: {
    alias: [
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
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});