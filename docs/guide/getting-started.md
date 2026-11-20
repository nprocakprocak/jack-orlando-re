# Getting started

You supply the game files. The engine reads them through a `GameFiles` object. It does not open a path of its own, and `PlayGame` has no document or canvas. The page or the script feeds files, input, and time, then draws what `view()` returns.

Install and build from the repository root:

```bash
npm install
npm run build
```

`npm test` does not need the game files.

Three ways to run a full session from this repository:

1. **`npm run dev`** — dev page in `examples/play`. ZIP field, or `JO_GAME_DIR` for a directory served at `/game/`.
2. **`npm run dev:embed`** — `examples/embed`. Imports only `jack-orlando-browser` and `jack-orlando-re`. No `JO_GAME_DIR` and no query string.
3. **`npm run play:desktop -- <directory-or.zip>`** — Electron. The main process listens on `127.0.0.1` and the page calls `mountPlayer`.

A ZIP for `examples/play` can be the game directory packed as it is; the assets may sit one folder down. Every other ZIP is packed from inside the game directory and holds at least the files the engine reads. The executable is not one of them. The paths are in [Assets](assets.md).

An outside project installs `jack-orlando-re` and `jack-orlando-browser` and calls `mountPlayer`. Node and the low-level canvas API are below. Paths inside the game tree are described in [Assets](assets.md).

## Node

Import the Node entry. It re-exports the browser entry and adds the two functions that touch the disk.

```ts
import { openDirectory, openZipFile, PlayGame } from "jack-orlando-re/node";

const fromDir = openDirectory(directory);
const fromZip = await openZipFile(zipPath);

const game = await PlayGame.create(fromDir);
await game.settle();
```

Signatures:

- `openDirectory(dir: string): GameFiles` reads files under `dir`. Lookup ignores case, so a directory copied from Windows works on Linux and on a case-sensitive macOS volume.
- `openZipFile(zipPath: string): Promise<GameFiles>` reads a ZIP of assets packed from inside the game directory, then calls `openZip`. The executable is not required.
- `PlayGame.create(files: GameFiles, opts?: PlayOptions): Promise<PlayGame>` loads the global archives and enters the first scene. `opts.start` defaults to `SC001`.

`settle()` resolves when a scene load has finished. `frame(input)` applies one frame of input. `update()` advances one logic tick. `advance(dtMs)` moves real time: the music fade, a movie, a scene film, and a dissolve between scenes. The browser host calls it with the loop's `elapsedMs`, and still calls `frame` and `update`. `view()` returns the picture, or `null` while nothing is ready. `phase` is `loading`, `playing`, `fading`, `movie`, `film`, or `finished`. `sceneName` is the current scene. `error` is set when a scene fails to load.

A frame of input is a `PlayInput`. Coordinates are screen pixels, 0..639 and 0..479.

```ts
const idle = { x: 320, y: 240, pressed: false, down: false, inWindow: true };

game.frame(idle);
game.update();
game.advance(dtMs); // milliseconds since the previous call

const view = game.view();
```

`pressed` is true when the left button went down since the last frame. `down` is true while it is held. Optional fields are `escape`, `right`, `middle`, `rightPressed`, `middlePressed`, and `ctrl`.

Useful `PlayOptions` fields:

| Field | Role |
|---|---|
| `start` | First scene. Default `SC001`. |
| `vars` | Starting values for named variables, such as `LAST`. |
| `dialogs` | Dialogue layer. Default on. `false`: a line waits `talkTicks`, and `DIALOG` uses `answer`. |
| `menu` | In-game menu. Default follows `dialogs`. Fonts come from `Resource.pak`. |
| `settings` | The options object the F4 menu edits. Omit it and the game builds one from `config`, `walkSpeed`, and the defaults. |
| `config` | Partial options. Used when `settings` is absent. |
| `walkSpeed` | Walk speed. Default 1. Used when `settings` is absent. |
| `persistSettings` | Called when an options window is left. |
| `easy` | Easy mode. |
| `inventory` | `"coat"` (default) or `"bar"`. |
| `backend` | Audio backend. Omit it for a silent game. |
| `save` | Save manager. Omit it and the save keys do nothing. |
| `saveMode` | `"files"` opens file windows. `"slots"` opens the ten-slot window. |
| `onExit` | Called with `"quit"`, `"finished"`, or `"death"`. |

### `npm run play:node`

```bash
npm run play:node -- path/to/a/directory
npm run play:node -- path/to/a/file.zip
```

With no path, the script says that no game files were given and runs a stand-in archive built in the script. That stand-in checks that the built Node package starts. It is not the game. Pass a directory, or a `.zip` of assets packed from inside the game directory. The executable is not required.

The script runs `npm run build`, imports `dist/node.js`, and calls `openDirectory` for a directory or `openZipFile` for a name that ends in `.zip`. It then runs:

```ts
const game = await PlayGame.create(files, { dialogs: false, menu: false });
await game.settle();
```

It feeds eight idle frames and prints `phase=... scene=...`. Dialogues and the menu are off, and nothing is drawn. A path that is not a directory or a `.zip` file prints `Expected a directory or a .zip file.`

## Browser

The published entry is safe in a browser bundler. See [Package exports](package.md).

```ts
import { openZip, PlayGame, CanvasPresenter } from "jack-orlando-re";

const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("missing canvas");
const presenter = new CanvasPresenter(canvas);

const file = input.files?.[0];
if (!file) throw new Error("missing zip");
const bytes = new Uint8Array(await file.arrayBuffer());
const files = openZip(bytes);

const game = await PlayGame.create(files);
await game.settle();

const inputState = { x: 320, y: 240, pressed: false, down: false, inWindow: true };
game.frame(inputState);
game.update();
game.advance(dtMs); // milliseconds since the previous call
const view = game.view();
if (view) presenter.present(view.surface, view.scrollX);
```

`openZip` takes a `Uint8Array`, not an `ArrayBuffer`. Read the file with `arrayBuffer()`, then copy it: `new Uint8Array(await file.arrayBuffer())`. `openZip` returns a `GameFiles` immediately. It does not return a promise. The ZIP is packed from inside the game directory, and the paths start at the archive root. The executable is not part of it. See [Assets](assets.md).

`CanvasPresenter` sets the canvas to 640 by 480 and copies that window of the scene surface. `present(framebuffer, scrollX, scrollY = 0)` uses the 2D context. It does not draw the cursor or the dialogue overlays. Those are `view.cursor`, `view.cursorImage`, and `view.overlays`. The caller draws them. `mountPlayer` does that for the example page.

`presentRgba(framebuffer, scrollX, scrollY, out?)` does the same copy into an RGBA buffer if you draw the canvas yourself.

### The example page

The `examples/play` package is a 640 by 480 canvas and a file input that accepts a ZIP of the game directory. The assets may sit in a subdirectory, so packing the directory without opening it is enough. The executable is not required. `main.ts` obtains the files and calls `mountPlayer` from `jack-orlando-browser`. That session owns the mouse, the keyboard, the audio, the start screen, and the menu. Aliases in `examples/play/vite.config.ts` point the package names at TypeScript source, so this page does not need `npm run build`. `examples/play/zip.ts` unpacks a chosen ZIP itself, in slices, and does not call `openZip`.

```bash
npm run dev
```

The dev server root is that package, so the page is `/`, not `/examples/play.html`. The same `npm run dev` and the same `JO_GAME_DIR` variable work on Windows, macOS, and Linux. If `JO_GAME_DIR` was set when the server started, the page loads files from `/game/` after a successful `HEAD` of `/game/Global.pak`. The server finds that file even when the on-disk name differs by case. Otherwise the page says the files were not found and offers a ZIP field. Choosing a ZIP replaces that source. The variable has no default. Set it in the same shell that starts the server, and restart the server after you change it. See [Assets](assets.md).

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
