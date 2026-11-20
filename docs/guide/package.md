# Package exports

The package name is `jack-orlando-re`. `package.json` publishes only the `dist` directory. Run `npm run build` before importing it. The build is ES modules (`packages/engine/vite.config.ts`). fflate stays external, so the bundler resolves that dependency itself.

## The exports map

| Import | Resolves to | Use |
|---|---|---|
| `jack-orlando-re` | `dist/index.js` (`types`: `dist/index.d.ts`) | Browsers and Node. The session and the format readers. |
| `jack-orlando-re/node` | `dist/node.js` (`types`: `dist/node.d.ts`) | Node only. Adds the two functions that read a path. |
| `jack-orlando-re/audio` | `dist/audio.js` | Mixer, music, and the Web Audio backend. |
| `jack-orlando-re/core` | `dist/core.js` | The frame loop, the display, and input. |
| `jack-orlando-re/cursor` | `dist/cursor.js` | Cursor pictures and the overlay. |
| `jack-orlando-re/gui` | `dist/gui.js` | Windows and the in-game menu. |
| `jack-orlando-re/launcher` | `dist/launcher.js` | Logos, the intro, and the wipe. |
| `jack-orlando-re/mainmenu` | `dist/mainmenu.js` | The title screen. |
| `jack-orlando-re/pause` | `dist/pause.js` | Pause when the page loses focus. |
| `jack-orlando-re/play` | `dist/play.js` | `PlayGame` and the scene host. |
| `jack-orlando-re/render` | `dist/render.js` | Surfaces, sprites, and `CanvasPresenter`. |
| `jack-orlando-re/save` | `dist/save.js` | Saves, slots, and the file picker. |
| `jack-orlando-re/settings` | `dist/settings.js` | The options store and stereo. |
| `jack-orlando-re/start` | `dist/start.js` | The start screen and the session flow. |
| `jack-orlando-re/video` | `dist/video.js` | `MoviePlayer` and the `.FLX` stepper. |

`main`, `module`, and `types` all point at the first entry. The `browser`, `import`, and `default` conditions of `"."` and of every subpath except `"./node"` are the same file. The `node`, `import`, and `default` conditions of `"./node"` are `dist/node.js`. Each subpath has `types` at `dist/<name>.d.ts`. The browser session imports these barrels (`jack-orlando-re/play`, `jack-orlando-re/audio`, and the rest). `"./node"` is the only entry that imports `node:fs`.

## Safe in a browser bundler

Import from `jack-orlando-re`, not from `jack-orlando-re/node`.

`packages/engine/src/index.ts` exports:

| Export | Role |
|---|---|
| `openZip(bytes: Uint8Array): GameFiles` | Index a ZIP of game assets. Paths start at the archive root. See [Assets](assets.md). |
| `PlayGame` | The session. `create`, `settle`, `frame`, `update`, `advance`, `view`. |
| `GameFiles`, `PlayInput`, `PlayOptions`, `PlayView`, `Phase` | Types for those calls. |
| `CanvasPresenter` | Draw a 640 by 480 window of a scene surface on a canvas. |
| `presentRgba` | The same window, as RGBA bytes. |
| Everything re-exported from `packages/engine/src/formats` | Archive, picture, sound, movie, text, scene, dialogue, and save readers. |

`openZip` depends on fflate. fflate is plain JavaScript and does not use Node.

`PlayGame` does not touch `document`. Pass it a `GameFiles` from `openZip` (or from your own `read` / `exists`), then draw `view()` yourself. See [Getting started](getting-started.md).

## The `./node` entry

`packages/engine/src/node.ts` imports `node:fs` and `node:path`. It re-exports the main entry and adds:

- `openDirectory(dir: string): GameFiles`
- `openZipFile(zipPath: string): Promise<GameFiles>`

A browser bundle should not import this entry. The library build marks every `node:` module as external, so a stray import would remain a `node:` import in the output rather than being bundled.

## `node:fs` stays out of the browser bundle

`packages/engine/src/index.ts` does not import `packages/engine/src/node.ts`, and it does not import `node:fs`.

Fonts are not compiled into the library. `JACK.FNT` and `JACKM.FNT` are read from `Resource.pak` through `Pak`, the same way as the pictures.

The example page imports `mountPlayer` from `jack-orlando-browser`. It does not import `jack-orlando-re/node`. `npm run dev` serves the `examples/play` package. Aliases in `examples/play/vite.config.ts` point those package names at TypeScript source, so the page does not need `npm run build`. `examples/play/zip.ts` unpacks a chosen ZIP itself and does not call `openZip`. On that page the ZIP may be the game directory packed whole, with the assets one folder down. `openZip` expects those assets at the archive root. See [Assets](assets.md).
