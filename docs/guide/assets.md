# Assets

The engine never searches for the game. You pass a directory, a ZIP of the game's assets, or any other `GameFiles`. This repository does not contain those files. See [docs/LEGAL.md](../LEGAL.md).

## A directory or a ZIP

Pack the ZIP from inside the game directory. Include at least the paths in the table below. The executable is not read, so leave it out. `openZip` and `openZipFile` look up those paths from the archive root.

`examples/play` also accepts a ZIP of the game directory itself, with the assets one folder down. Packing that directory without opening it is enough on that page.

Both produce the same `GameFiles` interface:

```ts
interface GameFiles {
  read(rel: string): Promise<Uint8Array>;
  exists?(rel: string): Promise<boolean>;
}
```

`read` returns the bytes of one relative path. `exists` is optional. Scene code uses it so a scene without insertion frames can load when `Data/<scene>.ph2` is absent.

| Function | Where | What it does |
|---|---|---|
| `openDirectory(dir)` | `jack-orlando-re/node` | Reads files under `dir`. Names match without regard to case. |
| `openZipFile(zipPath)` | `jack-orlando-re/node` | Reads a ZIP from disk, then indexes it. |
| `openZip(bytes)` | `jack-orlando-re` | Indexes a ZIP already in memory. Browser and Node. |

A relative path uses `/` or `\`. One leading `./` or `/` is removed. A path that is empty, contains `..`, starts with a drive letter, or starts with `//` is rejected. `openDirectory` throws `Invalid path` from `read` and returns false from `exists`. A missing file throws `File not found`. A path that lands on a directory throws `Not a file`.

In a ZIP, lookup ignores case. If the archive has two entries that differ only by case, the one whose spelling matches the request wins. Directory entries (names ending in `/`) are skipped. `openZip` uses fflate.

`openDirectory` joins the segments onto the directory you passed and matches each name without regard to case. On Linux, and on a case-sensitive macOS volume, `Global.pak` still finds `GLOBAL.PAK`. Windows and a normal macOS disk already do that in the filesystem. If two entries differ only by case, the spelling that matches the request wins. The strings below are the ones the engine passes to `read`. A ZIP matches case the same way.

## Paths the engine asks for

These paths are relative to the directory root, or to the root of the ZIP. Names inside an archive have no folders of their own.

| Path | When |
|---|---|
| `Global.pak` | Required at `PlayGame.create`. Pictures, sounds, and global animation lists. |
| `Resource/RESOURCE.PAK` | Required at `PlayGame.create`. Variables, item names, cursors, and Jack's frames. The start screen asks for `Resource/Resource.pak`. |
| `menu.PAK` | The opening sequence and the main menu, when the example page shows them. |
| `Action/<scene>.phk` | The scene. The first scene is `Action/SC001.phk`. A ZIP entry `Action/SC001.PHK` matches. |
| `Data/<scene>.ph2` | Optional. Insertion frames for that scene. |
| `Music/<track>` | A music file named by a `MUSIC` command. The compiler stores that name ending in `22.PMS`. |
| `Movies/<name>.AVX` | A movie. A script film `NAME.AVX` is opened as `Movies/NAME16.AVX`. The intro is `Movies/INTRO.AVX`. |
| `Movies/<name>.DLG` | Optional captions for that movie. |

`Global.pak` and `Resource/RESOURCE.PAK` have to be there or `PlayGame.create` fails. A scene archive has to contain that scene's `.CCG` and `.MCC`. Other scene members may be absent. A missing music track or a missing movie is skipped.

Inside `Action/<scene>.phk` the engine looks up members by the scene name plus an extension: `.CCG`, `.MCC`, `.ACE`, `.PCS`, `.ICS`, `.ACI`, `.SSD`, `.DCN`, `.FCC`, `.FCM`, plus the pictures and sounds those files name. `.PHK` and `.PH2` are the same archive layout as `.PAK`. Archive member names are matched without regard to case, and the first copy of a repeated name is the one that is read.

## What this repository does not contain

No game archive, no executable, no save, and no picture of the game. Tests build small invented files. Do not add the game to the tree. [docs/LEGAL.md](../LEGAL.md) is the checklist.

Fonts are read from the user's `Resource.pak`. Menu captions and lookup tables live in the engine modules that use them. The engine does not read the executable.

## `JO_GAME_DIR`

`JO_GAME_DIR` is an environment variable you set before `npm run dev`. It works the same on Windows, macOS, and Linux. `examples/play/vite.config.ts` reads `process.env.JO_GAME_DIR`. When it is set, the dev server serves that directory at `/game/` and finds a file even when the letters differ from the request (`Global.pak` serves `GLOBAL.PAK`). When it is unset, the plugin does nothing. There is no default path.

Restart the dev server after you change it. The example page then requests `/game/Global.pak`. If that request succeeds, the page uses the directory. If it does not, use the ZIP field on the page.

Set the variable in the shell that starts the server.

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

Windows (PowerShell):

```powershell
$env:JO_GAME_DIR = "C:\path\to\the\game"
npm run dev
```

The variable is only for the dev server. `openDirectory`, `openZip`, and `openZipFile` do not read it.
