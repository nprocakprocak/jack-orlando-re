import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import dts from "vite-plugin-dts";

const root = path.dirname(fileURLToPath(import.meta.url));

const SUBPATH_ENTRIES = [
  "audio",
  "core",
  "cursor",
  "gui",
  "launcher",
  "mainmenu",
  "pause",
  "play",
  "render",
  "save",
  "settings",
  "start",
  "video",
] as const;

/** vite-plugin-dts mirrors barrels under dist/<name>/; package exports use dist/<name>.d.ts. */
function subpathDeclarationEntries(): Plugin {
  return {
    name: "subpath-declaration-entries",
    closeBundle() {
      const distDir = path.join(root, "dist");
      for (const name of SUBPATH_ENTRIES) {
        const barrel = path.join(distDir, name, "index.d.ts");
        if (!fs.existsSync(barrel)) continue;
        fs.writeFileSync(path.join(distDir, `${name}.d.ts`), `export * from "./${name}/index";\n`);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: path.join(root, "tsconfig.json"),
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/play/testing.ts"],
    }),
    subpathDeclarationEntries(),
  ],
  build: {
    lib: {
      entry: {
        index: path.join(root, "src/index.ts"),
        node: path.join(root, "src/node.ts"),
        audio: path.join(root, "src/audio/index.ts"),
        core: path.join(root, "src/core/index.ts"),
        cursor: path.join(root, "src/cursor/index.ts"),
        gui: path.join(root, "src/gui/index.ts"),
        launcher: path.join(root, "src/launcher/index.ts"),
        mainmenu: path.join(root, "src/mainmenu/index.ts"),
        pause: path.join(root, "src/pause/index.ts"),
        play: path.join(root, "src/play/index.ts"),
        render: path.join(root, "src/render/index.ts"),
        save: path.join(root, "src/save/index.ts"),
        settings: path.join(root, "src/settings/index.ts"),
        start: path.join(root, "src/start/index.ts"),
        video: path.join(root, "src/video/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) => id === "fflate" || id.startsWith("node:"),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
      },
    },
  },
});
