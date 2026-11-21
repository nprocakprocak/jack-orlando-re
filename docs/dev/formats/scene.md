# Scenes: Action\*.PHK and Data\*.PH2

A scene is the archive `Action\SCxxx.PHK` (PAK format, [pak.md](pak.md)) of encrypted text files ([textcrypt.md](textcrypt.md)), pictures, sounds, and `.FLX` animations, plus an optional archive `Data\SCxxx.PH2` of animation frames. This note describes what `Scene_Load` (`0044ba80`) reads from those files and what that means for the engine: the background, objects and their `z`, perspective, the walk area, areas (including exits), characters, animations, and Jack's start point.

Parser: `packages/engine/src/formats/scene.ts` (`parseScene`, `parseCcg`, `parseAce`, `parsePcs`, `parseIcs`, `parseAci`, `parseSsd`, `parseMcc`, `jackStart`, `perspectiveScale`, `findTriangle`). The same model, in camelCase.

Checked on all 135 scenes.

## Opening a scene

`Game_Run` (`0043b9eb`…`0043bb86`):

1. The scene name sits in buffer `0x8a2680` (for example `SC006.xxx`). A script sets it (`GoToScene`; [scripts.md](../engine/scripts.md)). The last 3 characters are cut and replaced: `ACTION\SC006.PHK` (from the install directory when `g_introOnHdd`, otherwise from the disc) → `g_pakAction` `0x89c6f0`. `DATA\SC006.PH2` (always from the install directory) is opened only if it exists (`File_Exists`) → `g_pakSceneGfx` `0x6c2750`, flag `0x7a6e58`.
2. `Scene_Load(0x8a2680)` replaces the second-to-last character of the name with `C` (`SC006.CCG`), then calls the loaders in order: CCG, (objects → sprites), DCN, FCC, PCS, ACE, ACI, SSD, ICS, FCM, MCC. File names are the scene name plus an extension from the table `004f8c30`. In `g_debug` mode each step prints the file name and waits for a key.

Where pictures come from: the CCG, PCS, FCC, FCM, and ACI loaders read from `g_pakAction` (the PHK). Frames from `<scene>.ICS` live in the PH2 (SC001: 331/331 in the PH2). `Game_Run` (`00432cba`) loads them from the PH2 or from `g_pakGlobal`, chosen by flag `0x89794e`. A PH2 has 8129 entries. Only 30 of them also exist (identical) in the PHK. 94 scenes have a PH2.

`GoToScene` in the data twice names a file with an extension (`SC026.CFG` in SC025, `SC075.CFG` in SC076). It works, because the extension is replaced. Every `GoToScene` target has its own archive. The only scene no `GoToScene` leads to is `SC001` (the start of the game).

## What a PHK contains

| File | Loader | Contents |
|---|---|---|
| `SCxxx.CCG` | `Scene_LoadCcg` `004486d0` | background, objects, perspective, light, walk area, caption colors (**required**) |
| `SCxxx.ACE` | `Scene_LoadAce` `004475e0` | areas (named sets of triangles), including exits |
| `SCxxx.PCS` | `Scene_LoadPcs` `0044a000` | scene characters: frames per direction |
| `SCxxx.ICS` | `Scene_LoadIcs` `0044af70` | insertions — animations (the same format as `GLOBAL.ICS`, [global.md](global.md)) |
| `SCxxx.ACI` | `Scene_LoadAci` `00448410` | animations of CCG objects, and shadows |
| `SCxxx.SSD` | `Sound_LoadSceneSfx` `0044ad00` | the scene's sound list |
| `SCxxx.MCC` | `Script_CompileMacros` `00440cb0` | macros (the scene script, [scripts.md](../engine/scripts.md)) (**required**) |
| `SCxxx.DCN` | `Scene_LoadDcn` `00440520` | dialogue; `.DCG` is the unused copy ([textcrypt.md](textcrypt.md)) |
| `SCxxx.FCC` | `Scene_LoadFcc` `00440010` | talk faces |
| `SCxxx.FCM` | `Scene_LoadFcm` `0044b430` | special animations |
| `*.BM`, `*.PBM`, `*.0xx` | through CCG / ACI / PCS / FCC / FCM | pictures ([bm.md](bm.md), [pbm.md](pbm.md)) |
| `*.FLX` | `FLXn` slots from CCG plus `.ACI` | animations ([media.md](media.md)) |
| `*.PSD`, `*.S22` | SSD / dialogue | sound ([sound.md](sound.md)) |
| `GLOBAL.CCG`, `GLOBAL.MCC` | — | copies from `GLOBAL.PAK` ([global.md](global.md)) |

### Files with a numeric extension (`.047`, `.000`, …)

271 names unique inside an archive. They are ordinary pictures. The extension is the number of the scene in which the authors made them (for example `KIEP.047` in SC047A–D, `MONETA.077` in SC077, SC118, SC119). 249 are a 16-bit picture like `.BM` (`u16 w, h` plus `w·h` RGB565 pixels). 22 are `.PBM` (for example `GAZ.000`, `DL0.011`…`DL5.011`, `DRZWI.114`). The game does not look at the extension. The format follows from the **object type in `.CCG`** (`8` / `-8` → PBM, `16` → raw 16-bit) or from the loader that names the file. `verify` checks, for every object, that the file matches the type. `decodeSceneImage` in `packages/engine/src/scene/player.ts` does not pick a decoder by extension. Object type `8` / `-8` → PBM; otherwise a `.PBM` name → PBM; a size of `4 + 2·w·h` or `4 + 256 + w·h` → BM; anything else → PBM. Earlier, `.011` / `.012` / `.000` went to the BM decoder and the objects vanished (SC011 `DL0` / `DR0.011` and `DL1`–`5.011`, SC012 `DR0.012`, `GAZ.000` in SC000 / SC000B / SC000C / SC002). A PBM made of literals only has the size of an 8-bit BM, which is why the object type wins.

No picture in a PHK is an orphan. Every `.BM` / `.PBM` / `.FLX` / `.0xx` appears as a token in some text file of the scene or in `GLOBAL.*`.

## Tokenizer

Every loader reads the decrypted buffer `g_textBuf` with `Text_NextToken` (`00405f00`): a token is a run of bytes `> 0x20`. Numbers are CRT `atoi` / `atof` (a numeric prefix, the rest ignored, a non-number is 0). Most land in a `short` (truncated to 16 bits — the color `65504` is `-32`). Helpers:

- `Text_FindSection` `00406940` looks for a token equal to the name (both after `_strupr`) **from the start of the file**. It returns true only when text remains after the match. Section order is therefore free. The first occurrence counts (135 `.CCG` files contain 187 `[elementy]` headers — the second ones are not read).
- `Text_ReadShort` `00406020` (and the identical copy `00406140`), `Text_ReadFloat` `00406260`.
- At the end of the text `Text_NextToken` **does not write** the destination buffer. The loader gets the previous token again. The model in `scene.ts` reproduces that (buffers kept by name).
- `Str_Between` `0047d750` turns `[NAME]` into `NAME` (from the first `[` to `]` or the end).

## .CCG — background and objects

Sections, in the data always in this order: `[grafiki]`, `[perspektywa]`, `[obszar_chodu]`, `[kolor_liter]`, `[swiatlo]`, `[elementy]`, `[]`.

### `[grafiki]`

The first token is the **background** (`DEKxxx.BM`, 16-bit) → `g_sceneBg`, then `g_renderBg`. A missing section exits with the message that names the section `graphisc` (the spelling in the executable). An empty file exits with a length-error message.

- A `+` suffix (34 scenes) means a **scrolling background**: the scene buffer width is `0x3f8` instead of `0x280`, and the next token is the initial scroll (`0x6da628`; above `0x178` it becomes `0x178`, otherwise rounded down to 4). The maximum scroll `0x504686` is the background width minus 640 (at most `0x178`, aligned). In the data a background with `+` is exactly a background wider than 640.

Then **objects**, until a token that starts with `[`:

```
NAME type x y scale scaleB dx0 dy0 dx1 dy1 dx2 dy2 dx3 dy3
```

| Field | Variable | Meaning |
|---|---|---|
| name | `0x723880` (14 B) | picture file (after `_strupr`); `FLXn` is a `.FLX` animation slot |
| type | `0x652158` | `8` — PBM (`Pbm_Unpack`), an 8-bit sprite scaled by `scale`; `16` — the file loaded as-is (16-bit `w, h` plus pixels); `-8` — PBM, then treated as type 16 (`0x857bf8 = 1`) |
| x, y | `0x7c1258`, `0x7c7320` | top-left in the scene buffer; `y = 500` or `-1000` is off screen (a script shows it with `SetPositionE`) |
| scale | `0x57a988` | scale of an 8-bit sprite |
| scaleB | `0x57a890` | read, never used |
| quad | `0x86fc28` (16 B) | the object's footprint on the floor: 4 points relative to (x, y) |

Types in the data: 1356 × `16`, 571 × `8`, 20 × `-8`. An FLX slot (`type 16` and a name starting with `FLX` in `[grafiki]`) gets a 4×1 stand-in picture (`0x897860`), flag `0x851d5c`, and a zero quad. `.ACI` supplies the frames (`[FLXn]`).

**Layers:** `Scene_AddObjectSprites` (`00449c00`) adds a sprite for each object with **`z` = the object number** (order in the file; `[elementy]` are numbered after `[grafiki]`). Type 16 uses scale 16.0 (no scaling). Type 8 uses `scale`. The shared clip is `(0, 0, width, 0x1e0)`.

**The quad:** `Scene_Load` computes, for every object except FLX, the intersection of diagonals P0–P2 and P1–P3 (`Geom_DiagonalsIntersect` `0047eda0`) → `0x8ab6b8` / `0x8ab8d8`, and checks convexity (`Geom_IsLeftTurn` `0047eb00` > 0 for the triples P0P1P2, P1P2P3, P2P3P0) → `g_sceneObjQuadValid` `0x5575a8`. For a valid quad it separates equal neighboring coordinates by 1 (avoiding vertical edges). A valid quad is used for the "point in object" test (`Object_QuadContains` `00405240`, `Object_FindAtPoint` `00405480`, called from `Script_ExecStep` and `0042a7f0`) and, as a hypothesis, for sorting characters against objects (`00415960` in `Game_Run` compares a character's position with the quad). 548 of 1947 objects have a non-convex quad (usually all zeroes) and take no part in this.

A loader trap: if the text ends exactly on an object's last number, that object is read but the counter `0x57a980` does not grow, so the game skips it. It does not occur in the data (every file ends with `[]`).

### `[elementy]`

The same object format, with no FLX handling. In the data these are inventory icons (`IPODK.BM`, `REKAWI.BM`, `REKAWI_S.BM`, `95KTZW_I.BM`, `MONEY.BM`, and others) at `y = 500`. The count of all objects goes to `g_sceneObjCount` `0x7c7dfa`.

### `[perspektywa] a horizonY refY refScale`

The scale of a character at height `y` (among other places, `Script_ExecStep` and `00403d20`):

```
s(y) = (y − horizonY) · refScale / (refY − horizonY)
```

`horizonY` (`0x50470c`, copied to `0x69c7bc` and to every PCS character), `refY` `0x504708`, `refScale` `0x504704` (float). `Persp_ScaleAtY` (`00403d20`) clamps the result to 0.1…1 and divides by 3 (what the division is for is unknown). The first number `a` (`0x50470a`) is never read. `SetPersonData` on Jack with a scale and a reference height repeats `refScale` and `refY`.

### `[swiatlo]`

Pairs `x y` until the next `[` → `0x7cda40` / `0x7ca0b0`, count `0x723bd8`. Read by `004146e0`, `004150f0`, `00415960`, and `Game_Run`. Hypothesis: the light source for character shadows. In the data there is almost always one pair (for example `320 0`).

### `[obszar_chodu] N` — the walk area

`N` triangles `x1 y1 x2 y2 x3 y3` → `g_walkTris` `0x54adc0` (6 × s16), `g_walkTriCount` `0x8f690e`. Each triangle gets a y range (`0x9d1488`). Jack and the characters walk on the union of the triangles:

- `Walk_FindTriangle(x, y, from)` `004039e0` — the first triangle from `from` that contains the point (returns the index + 1, 0 = none). The test: `x1 ≤ x ≤ x3` (**it assumes vertices sorted by x**, which holds in all the data) and y in range, then the side of the point against the edges (`Geom_PointBelowLine` `00403430`: `(px−ax)·slope ≤ py−ay`; a vertical edge uses slope `dy·1e7`). Reproduced by `triangleContains` / `findTriangle`.
- `Walk_FindPath(goal, start)` `00459450` searches a path: a recursive search with a length limit (`Walk_SearchRec` `00459700`, up to 100 points) over triangle vertices and edge intersections (`00459d80`), segment length `0045a020`, best length `0x9d16f0`. The result is the point list `g_walkPath` `0x898108`, count `0x722ef8`. Callers: `Game_Run` (a click) and `Script_ExecStep` (`WalkTo`). The movement note is [walk.md](../engine/walk.md). For a scene it is enough to treat the path as a graph of triangle vertices with a visibility test inside the union of the triangles.

10 scenes have `N = 0` (cutscenes): SC000D, SC001, SC005, SC022, SC023, SC024, SC025, SC058B, SC086, SC203. **SC005 has no walking.** A scene with a walk area is SC002 (4 triangles, 2 exits) or SC004.

### `[kolor_liter]`

6 numbers (3 pairs `flag colorRGB565`, for example `1 65504 1 63480 1 63480`) → `0x5046d6`…. Read by `0040d250`, `0040d4b0`, `0040d620`. Hypothesis: talk-caption colors (Jack / the other speaker).

## .ACE — areas

```
N
[NAME] K x1 y1 x2 y2 x3 y3 (× K)
...
```

`Scene_LoadAce`: the name (brackets stripped, at most 30 B) → `0x898b68`, `K` (at most 15 — the table `0x8aa0c8` has 0xb4 B per area) → `0x871350`. `0x7c7d74[i]` is how many earlier areas share that name (an area may be several entries). Areas are named after the objects the cursor reacts to. Player actions call macros such as look, take, and show, named from the area, in `.MCC` ([areas.md](../engine/areas.md), [scripts.md](../engine/scripts.md)).

**Exits:** an area whose name is in `g_exitAreaNames` `0x503e10` (`LEWO PRAWO DOL TO_IN UP TO_OUT` plus 4 empty slots) goes onto `g_exitAreas` `0x85542c` (`Area_IsExitName` `00447570`). The exit macro is the show-macro for that name. In SC002 the left exit walks Jack to a point, stores the previous scene in `LAST`, and changes scene. Counts in the data: `LEWO` 80, `PRAWO` 70, `TO_IN` 70, `TO_OUT` 18, `UP` 6, `DOL` 6, empty name 2 (empty zone).

## Jack's start point and transitions

The scene script sets Jack's position: section `[PRE]` (before the scene is shown) and `[INIT]` (after), with `SetPosition JACK x y`, often inside `If LAST n … EndIf`. `LAST` is the game variable holding the previous scene number, set before the transition (`Let LAST` plus `GoToScene`). `parseMcc` extracts those positions (the last one in a block wins). `jackStart(scene, last)` prefers `[INIT]` over `[PRE]`, and a block for the given `LAST` over an unconditional one. 131 scenes give Jack a position in `[PRE]` or `[INIT]`. Examples: SC002 is `418 356` after SC004 (`LAST` 4) and `320 350` after SC006. SC005 is `400 336` for `LAST` 1 and `132 285` for `LAST` 24. The interpreter can also move him with other commands (`WalkTo`, `InitFirst`, `RunInsertion`). `jackStart` is only the initial position.

## .PCS — characters

```
[NAME] n framesPerDirection mode scale flag
direction (FILE.PBM x y z) × framesPerDirection
direction ...
[NEXT] ...
```

`Scene_LoadPcs`: the name (first and last character stripped) → `0x871b9f` (0x14 B each). `n` → a buffer of `n·0x14` B (`0x8ab968`; hypothesis: path points). Frames per direction → `0x7bf570`. `mode` < 2 → a 12000-byte buffer, otherwise `mode·2` bytes and a flag `mode ≠ 2` (`0x69c7a0`). `scale` (float, `0x652110`). `flag` → `0x7cde84`. Frames: a file from the PHK (`0x851de0`, up to 8 directions × 18 frames), file size `0x550238`, three numbers → `0x7ca0d8` (hypothesis: an x, y offset and a third value — compare the 7 numbers of an ICS frame, [global.md](global.md) and [persons.md](../engine/persons.md)). 64 scenes have a `.PCS`. Jack is not in `.PCS`. His animations are global.

## .ICS — insertions

The same format as `GLOBAL.ICS` ([global.md](global.md) describes the 7 numbers): sections `[NAME]`, each with frames `FILE.PBM a b c d e f g` (s16). `Scene_LoadIcs`. A frame may be preceded by `Effect SOUND v1 v2 v3`. The sound must be on the scene's SSD list or the global list, or the loader exits with a missing-sound message. `v1` → `+0x1e`, `v3` → `+0x20`. `v2` is read and **discarded**. Limits: 1000 frames, 60 sections. Frames live in the PH2. Macros call them with `RunInsertion` and `InitFirst`.

## .ACI — object animations

For **every** CCG object the loader looks for a section `[OBJECT_NAME]` (`SceneAnim_LoadObject` `00447c20`):

```
[KA1.BM]
count
REC i i i … END ← a sequence of picture numbers (0 = the object's base picture), max 299;
REC … END a negative first value is replaced with its absolute value
FILE x y ← picture 1, 2, … (from the PHK) with an offset
```

`[FLXn] frameCount FILE.FLX x y` is an FLX animation slot. After the objects, `[SHAD0]`…`[SHAD3]`: pairs `x y` (`SceneAnim_LoadShadow` `00448250`; hypothesis: shadow shapes). A section whose name is not in the CCG is not read. In the data every section has its object, except the reverse: `FLX1` in SC090 has no section (FLX1 without an animation). `PUSTY.PBM` as a picture is in [pbm.md](pbm.md).

## .SSD — scene sounds

A list of `*.SND` names. For each one the game loads `<name>.PSD` from the PHK (`Path_SetExtension`), unpacks it (`Sound_Unpack`, [sound.md](sound.md)), and appends it to the sound table after the global sounds (`0x7c73a0`, 14 B per name). It remembers `KROK1.SND` / `KROK2.SND` as the footstep sounds.

## .MCC — macros

After decryption this is plain text, one command per line, indented with `TAB`, comments between two `/` (including `/* … */`). Sections `[NAME]` are macros: `[PRE]`, `[INIT]`, and actions on areas (look, take, show, use, and the rest). Commands seen in the data include `Brightness`, `Let`, `If`, `Iff`, `EndIf`, `SetPositionE`, `SetSpecArea`, `Anima`, `AnimaEffect`, `WalkEffect`, `SetShadow`, `MaxShadow`, `MinShadow`, `SetPersonData`, `SetDirWalk`, `WalkToDir`, `WalkTo`, `SetPosition`, `RunInsertion`, `InitFirst`, `Stay`, `StayDef`, `Hide`, `OutMacro`, `NormalMacro`, `PointRotate`, `ChWindow`, `WaitWhile`, `GoToScene`, `RotateTo`, `ShowFace`, `Talk`, `HideFace`, `SetFrame`, `SaveAble`, `MoveP`. The compiler knows about 150 commands (`00440cb0`). The full list and the meaning of each are in [scripts.md](../engine/scripts.md). `parseMcc` extracts only section names, `GoToScene` targets, and Jack's positions. It does not store a script body.

## .DCN, .FCC, .FCM

Details, confirmed in the loaders, are in [dialog.md](dialog.md) and [global.md](global.md):

- `.DCN` is lines and answer blocks. Spaces are stored as `_`. A `=` before `!` or `?` is a narrow gap in the font, not part of the spoken line. `Q <id> <n>` is an answer menu of `n` options (`DIALOG` / `IFANSWER`).
- `.FCC` is a speaker face: a face picture, an eye position, eye frames, a mouth position, mouth frames.
- `.FCM` is `[NAME]`, a time, `.PBM` frames, and `Effect` lines as in ICS.

## Engine API

`parseScene(pak, "SC002")` returns the background name (a 16-bit `.BM` from the PHK), whether it scrolls, the objects (`z` is the index; type 8 or −8 is PBM, 16 is raw or FLX), the walk triangles, the perspective, the areas (exits included), and `jackStart(scene, lastScene)` for the start position.

## Checks

Whole scene archives are checked (135), because the files of a scene refer to each other. `verify` requires CCG and MCC and `[grafiki]`. The background exists, is 16-bit, and its width matches `+`. Every object has a file whose format matches its type. Every FLX slot has an ACI section, except the known SC090 / FLX1. Walk triangles are sorted by x. ACE loads in full, within the area limits. ICS frames are in the PHK or the PH2. `Effect` sounds are on the scene SSD list or `GLOBAL.SSD`. PCS frames and ACI pictures exist. Every `.PSD` named by the SSD exists. Every `GoToScene` target has an archive. Result: 135/135. Tests: `packages/engine/src/formats/scene.test.ts`.
