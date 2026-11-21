# Global files: frame lists .ICS / .FCM, GLOBAL.*, *.SFB, CM*.BIN

Parser: `packages/engine/src/formats/global.ts` (`parseIcs`, `parseFcm`, `parseGlobalCcg`, `parseMacros`, `parseSsd`, `parseSfb`, `parseCm`, `decodeGlobal`). Addresses inside `Game_Run` (`00432…`, `00433…`) come from the disassembly. That function was not recovered as one procedure.

| File | Where | Cipher | Who reads it |
|---|---|---|---|
| `GLOBAL.ICS` | `GLOBAL.PAK` | yes | `Ics_LoadSection` `004069f0` — one section at a time, on demand |
| `GLOBAL.FCM` | `GLOBAL.PAK` | yes | `Fcm_LoadSection` `0040ee20` — one film at a time |
| `<scene>.ICS` / `.FCM` | `Action\*.PHK` | yes | `Scene_LoadIcs` `0044af70` / `Scene_LoadFcm` `0044b430` — the whole file (same syntax) |
| `GLOBAL.CCG`, `GLOBAL.MCC`, `GLOBAL.SSD` | `GLOBAL.PAK` (plus CCG/MCC copies in every PHK) | yes | nobody (below) |
| `*.SFB` (23) | `RESOURCE.PAK` | no | `Jack_LoadWalkFrames` `00416a90`, `Jack_LoadWalkFramesUniform` `00417e40` |
| `CM220`…`CM316.BIN` (7) | `RESOURCE.PAK` | no | `Game_Main` `0044d1d0` → `Film_Play` `0040f450` |

Text: cipher and Mazovia in [textcrypt.md](textcrypt.md). Loaders read tokens with `Text_NextToken` (`00405f00`, runs of bytes `> 0x20`; a space equals a line ending) and numbers with `Text_ReadShort` (`00406020`: `atoi` into `int16`). The data contains only decimal numbers.

## .ICS — insertions, animations with an anchor

Error messages call the format an "INS file". It is a list of character animations. In `GLOBAL.ICS` that is Jack: shots `KOLT`, `KLFR`, …, bending, picking up, reaching `SP*` / `SW*`, `MONETA`, wiper motions `*_WYC_*`, and so on. In scenes it is local animations of Jack and of objects.

### Syntax

```
[NAME] ; section; '[' and ']' stripped, name upper-case, ≤ 29 characters
FILE.PBM a b c d e f g ; frame: name ≤ 13 characters + 7 numbers
EFFECT sound channel x volume ; optional, BEFORE the frame it belongs to
```

- A section lasts until the next `` or the end of the file.
- `EFFECT` attaches a sound to the next frame. If no frame follows (end of the section or the file), the effect is dropped (the record is zeroed at the start of the next iteration). That happens twice in the data, both in `SC117.ICS` ([effects that never play). Two `EFFECT` lines in a row are not handled (the second would become a frame name). They do not occur in the data.
- `Scene_LoadIcs` runs `strupr` on every token, so `Effect` works too (492 times `Effect`, 95 times `EFFECT` in scenes). `Ics_LoadSection` (`GLOBAL.ICS`) compares the token with `"EFFECT"` **without** `strupr`. `GLOBAL.ICS` has no effects, so this has no consequence.
- A section in `GLOBAL.ICS` is found by `Text_FindSection` (`00406940`): it rewinds to the start and looks for a token equal to `"[" + name + "]"` after `strupr`.

### Frame fields (a 0x22-byte record in `g_insFrames` `0x71a840`)

| Field | Offset | Meaning | Evidence |
|---|---|---|---|
| name | `+0x00` | `.PBM` file; `GLOBAL.ICS` from `GLOBAL.PAK`, scene frames from the scene `.PH2` (`g_jackInsFromScene` `0x89794e`) | `00432cba` |
| **a** | `+0x0e` | **anchor X when Jack faces right** (`g_jackInsDir` = 1) → `g_jackHotX` `0x7cda3c` | `00432a9d` |
| **b** | `+0x10` | **anchor X of the mirrored frame** (Jack facing left) → `g_jackHotX` | `00432ac3` |
| **c** | `+0x12` | **anchor Y** (the foot line) → `g_jackHotY` `0x7bf07a` | `00432adb` |
| **d, e** | `+0x14`, `+0x16` | **offset (dx, dy) of shadow 1** from Jack's position; `d ≥ 1000` means no shadow | `004337d5`…`00433a64` |
| **f, g** | `+0x18`, `+0x1a` | **the same for shadow 2**; `f ≥ 1000` means none | `00433a6b`…`00433cc1` |
| effect | `+0x1c` | −1 = none; a scene stores the sound index from `.SSD` (`Sound_FindSceneSfx` `00407b30`; a miss exits with a missing-sound message); `GLOBAL.ICS`: 0, the name in one shared buffer `0x6bd208` | `0044af70`, `004069f0` |
| channel | `+0x1e` | 0 = play on channels 1 and 2, otherwise the channel number | `0043291e` |
| volume | `+0x20` | 0…64 (`Sound_PlayIndexed` `004075d0` doubles it and clamps to 64) | `00432935` |

The third `EFFECT` number (`x`) goes to `0x6da430` and is unused.

**The anchor** (a, b, c) is the same layout as in `.SFB` (below) and in the standing-frame constants. `Jack_LoadWalkFrames` writes, for `SSFR2.PBM`, `xRight = 46`, `xLeft = width − 46`, `y = 264`. The frame is drawn so that the point (a or b, c) lands on Jack's position (`0x7c7a54`, `0x7c7a60`). That draw sits in `Game_Run` `00433204` / `004332b1` and was not followed line by line. In the data `a + b = frame width` for 1331 of 1648 `GLOBAL.ICS` frames (the rest differ by a few pixels — the mirrored point was placed by eye).

**Shadows** are drawn by `Jack_DrawShadow` (`00427b20`, `param_5` = shadow number 0/1 — two separate sprites; likely two light sources in the scene). Position = Jack's position + `(±dx, dy)`, with `dx` negated when mirrored. Both components are multiplied by Jack's perspective scale `0x504700`, unless the script turned scaling off (`0x8a267a`). The shadow picture is the directional `SH_FR` / `SH_PR` / `SH_BA` / `SHSFR` / `SHSBA04.PBM` for Jack's direction (`0x8f6916`, frame number 3). When the frame has both shadows (`g_jackTwoShadows` `0x69d7c0`) it is the round `CIEN1.BM`. When a shadow disappears (`d ≥ 1000`) the sprite is removed (`Sprite_Remove`).

**Time.** ICS frames have no duration. The next frame is taken when the counter `g_jackInsDelay` (`0x8713f4`, decremented in `Game_TimerTick`) reaches 0. It is loaded from `g_insFrameDelay` (`0x504794`: default 5, set by a script command — `Script_ExecStep` case 3). Direction is set by `Ins_StartGlobal(name, direction, …)` (`00403110`) or by a script command (case 2: 0 → right, 1 → left, 2 → Jack's current direction `0x504780`).

### Tables and limits

- Frames: `g_insFrames`, max 1000 (the loader reports too many lines). Sections: `g_insSections` `0x722ff8`, a 0x22-byte record (30-byte name, `+0x1e` start, `+0x20` count), max 60 (too many insertions).
- A scene loads its sections from 0. A section from `GLOBAL.ICS` goes into slot `g_insSectionCount` (`0x88f4ba`), its frames from `g_insFrameCount` (`0x7a837c`) — after the scene's frames — and is overwritten on the next call. That is why `GLOBAL.ICS` can have 128 sections.
- An animation is chosen by name with `Ins_Find` (`0040dbd0`). For object `n` it sets the range `0x89792c[n]`…`0x871b7c[n]`. For Jack it sets `g_jackInsFrame`…`g_jackInsEnd`.

Data: `GLOBAL.ICS` has 128 sections, 1648 frames, 0 effects. a is 28–148, b is 34–135, c is 259–268, d is −23…24, e is −5…6, and f = g = 1000 on every frame (global animations have only shadow 1). In 95 scene files shadow 2 is used on 1061 frames. All 1102 distinct pictures from `GLOBAL.ICS` / `GLOBAL.FCM` are in `GLOBAL.PAK`. The other 107 pictures in `GLOBAL.PAK` are UI (`FIR*`, `HAF*`, `JACK*`, `STAD*`, `INV_*`, `OPT*`, `A_UP*` / `A_DN*`, `MAP2`). Every `GLOBAL.ICS` section is named either in the executable or in a scene script.

## .FCM — short films in a window

Played by `Film_Play(name, x, y, mode, global)` (`0040f450`), including from `RunGlobalFilmP` (in `GLOBAL.MCC` that command plays `PODKOWA` at the given position and mode). Film lookup: `Film_Find` (`0040dd20`; a miss reports that there is no film).

```
[NAME]
N ; frame time in ms; N < 0: a "positioned" film
BACKGROUND.PBM ; the first name is the background, drawn once
FRAME.PBM ; later frames (when N < 0: FRAME.PBM x y)
Effect sound channel x volume ; any number, before the frame on which it should play
```

- `|N|` goes to `Timer_WaitSinceFrameStart(|N|)` after each frame (milliseconds, 5 ms resolution). The last frame holds for `Timer_Sleep(3·|N|)`. Both global films have `N = 100` (10 frames/s).
- `N < 0`: every frame after the background has an offset `x y` from the background (`g_filmFrameX/Y` `0x870818` / `0x870d00`). When mirrored, `x` is measured from the right. Five such films exist, all in scenes.
- `EFFECT` (the token after `strupr`, any case) remembers the frame number = the count of frames before it (background = 0) and plays just before that frame is drawn. In `GLOBAL.FCM` (`Fcm_LoadSection` `0040ee20`) the sound extension is replaced with `.S16` (`Path_SetExtension`), which is why `GLOBAL.SSD` has the pair `001-08-2.SND` / `001-08-2.S16`. In `<scene>.FCM` (`Scene_LoadFcm` `0044b430`) the name stays (`.SND`) and `Sound_FindSceneSfx` `00407b30` turns it into an index in the scene bank. Channel 0 means channels 1 and 2. The third number is unused. The fourth is the volume (a byte). At most 20 effects per film — table `0x7c7e50`, with no check in the code. The data has at most 10.
- `Film_Play` mode: 1 and 3 mirror the picture, 2 and 3 apply a **round mask**. The `CM*.BIN` table is chosen by the width of the first frame (220, 240, 260, 280, 300, 310, 316) and the frame `IM*` (`0x6c2758 + i·10000`). The window is centered on (x, y) and pushed back onto the screen.
- Tables: films `g_films` `0x551618` (0x28 B), frame names `g_filmFrames` `0x553480` (14 B). A film from `GLOBAL.FCM` occupies slot `g_filmCount` (`0x752b48`).

`GLOBAL.FCM` contains `[PODKOWA]` (background + 46 frames, 4 effects — the horseshoe going into the glove) and `[WIAZKOTW]` (background + 75 frames — tying the anchor to the rope). Both are called from the item-combination macros.

## GLOBAL.CCG, GLOBAL.MCC, GLOBAL.SSD

- `GLOBAL.CCG`: an `[elementy]` section, 5 items (`IPODK.BM`, `REKAWI.BM`, `REKAWI_S.BM`, `95KTZW_I.BM`, `MONEY.BM`), each plus 13 numbers, ending with `[]`. The numbers mean the same thing as a scene's `[elementy]` section ([scene.md](scene.md)).
- `GLOBAL.MCC`: item-combination macros named `[A-B]`. One combines the horseshoe picture with the glove, plays the `PODKOWA` film, grants the filled glove, and sets `SILNY`. Another ties the anchor to the rope. Commands are in [scripts.md](../engine/scripts.md).
- `GLOBAL.SSD`: `001-08-2.SND`, `001-08-2.S16`.
- **No code reads these three files** (the executable does not name them). Their contents are pasted into every scene instead: all 135 `<scene>.MCC` files contain the combination macros, and `<scene>.CCG` contains the same items. `GLOBAL.*` is the source the authors' tool appended to scene files. The copies inside each PHK are redundant.

## *.SFB — anchors of Jack's walk and turn frames

Binary, no header: triples of little-endian `int16` `(xRight, xLeft, y)` — the same as ICS fields a, b, c. Triple `i` belongs to frame `i+1` of the series:

| File | Triples | Frames | Buffer |
|---|---|---|---|
| `FRON`, `BACK`, `PROF`, `SKFR`, `SKBA` | 12 | `FRON1`–`12.PBM` and the matching series (walk: front, back, profile, diagonal front, diagonal back) | `0x7c7db0`, `0x7c7d28`, `0x7c7e00`, `0x8aca48`, `0x8ac9d0` |
| `FRONW`, `BACKW`, `PROFW`, `SKFRW`, `SKBAW` | 12 | walk **in the uniform**, `FRONW01`–`12.PBM` and so on — two-digit numbers (`Res_MakeNumberedName` width 2; civilian frames use width 1). Loaded by `Jack_LoadWalkFramesUniform` `00417e40` (`EXTRA 6`; this is the uniform, not a weapon variant) | the same buffers as the civilian set |
| `OBPL_0`–`7` | 4 | `OBPL01`–`32.PBM`; file `n` is frames `4n+1`…`4n+4` | `0x7c0e60 + n·0x30` |
| `OBPLBF`, `OBPLFB` | 8 | `OBPLBF1`–`8`, `OBPLFB1`–`8` | `0x7c1010`, `0x7c1040` |
| `PROPRO` | 9 | `PROPRO1`–`8` — the 9th triple has no frame (ninth anchor) | `0x7c0fe0` |
| `ROTP`, `ROTW` | 17 | turn `ROTP01`–`17` (`ROTW01`–`17` in the uniform). `00416a90` splits the table into 8 directions of 4 triples (`0x7c10d0`…, some in reverse order) | `g_fileBuf` |

`verify` checks that the file size is 6 × the frame count of the series. Example: `FRON.SFB` starts `(47, 59, 257)`, and `FRON1.PBM` is 106 wide = 47 + 59.

## CM*.BIN — round masks

`CM<d>.BIN`: `d` bytes = `d/2` little-endian `uint16` values. Value `i` is how many pixels to clear from the left and from the right in row `i` of the top half of a frame of size `d` (the bottom half is symmetric): a circle of diameter `d`. `Film_Play` does this with `memset` on the frame buffer. The values fall to 0 in the middle. For `CM240` / `280` / `316` the value is exactly `round(r − √(r² − (r − i − ½)²))`, `r = d/2`. The others differ from that formula by ±1 on some rows — computed by a different tool. Tables of 0x140 B from `g_circleMasks` `0x8982a0`.

## Checks

All 422 files parse: `GLOBAL.*` (including the copies in PHK), 95 `.ICS`, 24 `.FCM`, 23 `.SFB`, 7 `CM*.BIN`. The parsers reject a missing section at the start, a truncated record, a non-number, a number outside `int16`, names longer than the game's buffers, two `EFFECT` lines in a row in ICS, a table past its limit, a film with no frames, and a bad `.SFB` or `CM` size. Tests: `packages/engine/src/formats/global.test.ts`.

## Direction

`0x8f6916` (`g_jackDir`) is **Jack's direction 0–4**. It was previously mistaken for a weapon flag. `004146e0` sets it from the codes `LU`/`RU` → 4 and `LD`/`RD` → 3 (with `0x504780 = ±1` as the mirror), and the shadow tables `SH_FR` / `SH_PR` / `SH_BA` / `SHSFR` / `SHSBA` (`0x855240 + direction·0x30`) and the standing frames `SS*2.PBM` (`0x878a70 + direction·0x36b6`) are indexed by this variable.
