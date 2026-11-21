import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: path.join(root, "tsconfig.json"),
      include: ["src"],
    }),
  ],
  build: {
    lib: {
      entry: path.join(root, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (id) => id === "jack-orlando-re" || id.startsWith("jack-orlando-re/"),
    },
  },
});
