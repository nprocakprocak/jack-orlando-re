# Jack Orlando Reverse Engineered

An engine that plays Jack Orlando game from files you supply. The name "Jack Orlando" only identifies which game those files belong to. This project has no connection with the rights holder.

Jack Orlando was developed by Toontraxx Studios and published by TopWare Interactive. The reverse engineering was made from the original Jack Orlando Director's Cut engine, sold as <a href="https://store.steampowered.com/app/253960/Jack_Orlando_Directors_Cut/" target="_blank" rel="noopener noreferrer">Jack Orlando: Director's Cut</a>.

The engine runs inside a web browser or you can launch it as a desktop app on any operating system.

Currently only Polish version is supported, sorry. Working on English version as well (in progress).

Running this engine requires assets from a legally acquired copy of the game. Those assets are not published in this repository. It has no archives, no executable, and no pictures of the game.

In order to prepare the assets, install the original game in a directory. Then provide the path to the game in `JO_GAME_DIR` environment variable (see below) and run the engine. Alternatively, you can archive the game assets into a zip file and pass it to the engine. You can simply zip all files in the game folder, however not all files are required, for example executables are not used at all. For the actual assets list, see [Assets](docs/guide/assets.md).

## Build

Node.js 22.12 or newer. `npm install` installs Electron 45, which requires that version.

```bash
npm install
npm test
npm run build
```

## Run

There are three ways to play from this repository:

1. **`npm run dev`** — an example of how to embed the engine on a web page. You can provide the game directory via `JO_GAME_DIR` or assets packed to zip. You can also use query string to manipulate the engine with dev parameters.
2. **`npm run dev:embed`** — a minimal example, you provide the zip file and play.
3. **`npm run play:desktop -- <directory-or.zip>`** — an example of how to run the engine as a desktop application using Electron. The desktop app runs on Windows, Linux and MacOS. Provide the assets via `JO_GAME_DIR` or zip archive.

Set `JO_GAME_DIR` to your game directory in the same shell that starts the dev server, or leave it unset and choose a ZIP on the page. There is no default directory. A directory is matched without regard to case, so a folder copied from Windows works on Linux.

### Examples

PowerShell:

```powershell
$env:JO_GAME_DIR = "C:\path\to\the\game"
npm run dev
```
or

```powershell
npm run dev:embed # then load the zip file on the page
```

cmd:

```bat
npm run play:desktop -- C:\path\to\the\game\or\zip
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
npm run play:desktop
```

## Guide

More details, how assets are encoded and how the engine works:

- [Getting started](docs/guide/getting-started.md) — Node, the browser page, and a canvas
- [Assets](docs/guide/assets.md) — directory, ZIP, and the paths the engine reads
- [Formats](docs/guide/formats.md) — archives, graphics, sound, video, and the text cipher
- [Scripts](docs/guide/scripts.md) — macro language and scene configuration
- [Package exports](docs/guide/package.md) — what a browser bundle can import

People changing a parser should use [docs/dev/formats](docs/dev/formats/).
