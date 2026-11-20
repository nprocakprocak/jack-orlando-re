# Jack Orlando Reverse Engineered

An engine that plays Jack Orlando from files you supply. The name "Jack Orlando" only identifies which game those files belong to. This project has no connection with the rights holder.

This repository does not contain the game. It has no archives, no executable, and no pictures of the game. The boundary is [docs/LEGAL.md](docs/LEGAL.md). Fonts are read from the user's `Resource.pak`. Menu captions and lookup tables live in the engine modules that use them. The engine does not read the executable.

The workspace publishes `jack-orlando-re` from `packages/engine` and `jack-orlando-browser` from `packages/browser` (version 0.0.0, ES modules). An outside project installs those package names and calls `mountPlayer` from `jack-orlando-browser`. `npm install` at the repository root does not install the engine, because the root is a private workspace. Depend on `jack-orlando-re` from npm or from `file:packages/engine` in a consumer `package.json`.

The engine's only runtime dependency is [fflate](https://github.com/101arrowz/fflate), used to read a ZIP in memory. TypeScript, Vite, and Vitest are development dependencies.

## Build

```bash
npm install
npm test
npm run build
```

`npm test` runs the suite in `jack-orlando-re`, then in `jack-orlando-browser`. The tests build their own bytes, so they do not need the game. `npm run build` writes the engine to `packages/engine/dist/` (`packages/engine/vite.config.ts`), then builds the browser session package. `npm run check` typechecks both packages without emitting files.

## Run

Three ways to play from this repository:

1. **`npm run dev`** — dev page in `examples/play`. ZIP field, or `JO_GAME_DIR` for a directory served at `/game/`.
2. **`npm run dev:embed`** — `examples/embed`. Imports only `jack-orlando-browser` and `jack-orlando-re`. No `JO_GAME_DIR` and no query string.
3. **`npm run play:desktop -- <directory-or.zip>`** — Electron. The main process listens on `127.0.0.1` and the page calls `mountPlayer`.

The dev page loads game assets from a ZIP file you choose on the page. Pack the game directory as it is: on this page the assets may sit in a subdirectory of the archive. The executable is not required. You can also point the page at a directory with the `JO_GAME_DIR` environment variable.

A ZIP passed to `openZip`, `openZipFile`, the embed example, the desktop window, or `npm run play:node` holds the assets at the archive root. Go into the game directory and pack at least the files the engine reads. The executable is not one of them. The paths are in [Assets](docs/guide/assets.md).

The browser page is the way to play, on Windows, macOS, and Linux. Set `JO_GAME_DIR` to your game directory in the same shell that starts the dev server, or leave it unset and choose a ZIP on the page. There is no default directory. A directory is matched without regard to case, so a tree copied from Windows is found on Linux. Restart the server after you change the variable.

PowerShell:

```powershell
$env:JO_GAME_DIR = "C:\path\to\the\game"
npm run dev
```

cmd:

```bat
set JO_GAME_DIR=C:\path\to\the\game
npm run dev
```

bash:

```bash
JO_GAME_DIR=/path/to/the/game npm run dev
```

Linux:

```bash
export JO_GAME_DIR=/path/to/the/game
npm run dev
```

macOS, in Terminal (zsh):

```zsh
export JO_GAME_DIR=/path/to/the/game
npm run dev
```

Vite opens `/` on the dev server for `examples/play`. Details are in [Getting started](docs/guide/getting-started.md) and [Assets](docs/guide/assets.md).

A Node script checks that a directory or a ZIP loads, then prints the phase and the scene. The ZIP is the one above: assets packed from inside the game directory. The script does not open a window. It builds the library first. With no path it says so and runs a stand-in archive, only to check that the built package starts.

```bash
npm run play:node -- path/to/the/game
```

## Guide

- [Getting started](docs/guide/getting-started.md) — Node, the browser page, and a canvas
- [Assets](docs/guide/assets.md) — directory, ZIP, and the paths the engine reads
- [Formats](docs/guide/formats.md) — archives, graphics, sound, video, and the text cipher
- [Scripts](docs/guide/scripts.md) — macro language and scene configuration
- [Package exports](docs/guide/package.md) — what a browser bundle can import

People changing a parser should use [docs/dev/formats](docs/dev/formats/). Those notes are not this guide.