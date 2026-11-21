# Save files: `SAVEGAME\*.SAV` / `*.SVL`, `tempjs`, `Jacksave.00a`

The file written by `Save_WriteState` `00408560` and read by `Save_LoadState` `00409090`, and the copy made by `Save_CopyTemp` `00407bb0`. When and under what name the game saves (file windows, F2/F3/F5/F6, the autosave, `tempjs`, slot mode) is [savegame.md](../engine/savegame.md). Parser: `packages/engine/src/formats/save.ts` (`parseSave`, `writeSave`, `currentHeader`, `copyHeader`, `copyTemp`, `savedMusic`, `itemImage`, `acceptedBy`, `verifySave`).

Checked against the saves of a Steam installation.

## 1. Files

| File | Who writes it | Contents |
|---|---|---|
| `tempjs` | `Save_WriteState(path, 1)` on entry to every scene (`Game_Run` `0042bc3a`) | state from the start of the scene, a full header, pose byte = 0 |
| current save (F2 / menu / F5) | `Save_WriteState(path, 0)`, when `g_sceneSaveable && g_jackPlaced` | the current state, pose byte = `g_sceneSaveable` (= 1) |
| a copy (F2 / menu / F5 in a scene that "cannot be saved", autosave `AUTO - ZAPIS.sav`) | `Save_CopyTemp(path)` | the bytes of `tempjs` with a copy header (§3) |
| `*.SVL` / `.svl` | the same, in the easy version (`g_easyVersion`) | header ending in the light-version marker |
| `Jacksave.00a` | **Director's Cut does not write it** (the name is not in the executable) | a file from an older distribution (§6) |

There is one format for all of them. `.sav` and `.svl` differ only in the header, and `tempjs` is an ordinary save with no extension. The `tempjs` header depends on the mode last played: after an easy-version session it carries the light-version marker (byte 15 = `'l'`).

## 2. Layout

Little-endian, no compression, no checksums. Everything is raw bytes of global variables, written in order by `fwrite` (`00486a30`) and read by `fread` (`00487700`) in the same order.

| Offset | Size | Field | Write `00408560` | Read `00409090` |
|---|---|---|---|---|
| `0x000` | 80 | header (text with NUL, the rest zeroes) | `strcpy(0x8a8db0, "Jack Orlando - normal ver"` or `"Jack Orlando - light ver")`, 0x50 B | into `0x8a8db0`; **byte 15** compared with `'l'` (§3) |
| `0x050` | 13 | music, for example `TR17-22.PMS` | the current track `0x87123c`; if it starts with `TR02` (menu / launcher music) — `"TR17-22.PMS"` | into `0x5640c8`; if it differs from the current track and music is on → `Music_Stop(2)` |
| `0x05d` | 15 | scene, for example `SC013.CCG` | `g_sceneName` `0x8a2680` | into `g_sceneName` |
| `0x06c` | 2 | `u16` variable count | `g_varCount` `0x8f68f0` | into `g_varCount` (**overwrites** the count from `VARIABLE.ALL`) |
| `0x06e` | 1000 | 500 × `i16` variable values | `g_varValues[0..499]` `0x8a27d8` | the same |
| `0x456` | 2 | `u16` item count *n* | occupied slots `g_invOccupied[0..83]` | zeroes 84 slots, then reads |
| `0x458` | *n* × 3556 | items (below) | slots 0…83 in order, occupied ones only | `g_invOccupied[slot] = 1`, name and picture into the slot |
| end − 23 | 23 | tail (below) | | |

File size = **1135 + 3556·*n*** (checked on every file).

An item (3556 B):

| + | Size | Field |
|---|---|---|
| 0 | 2 | `u16` coat-slot index 0…83 ([inventory.md](../engine/inventory.md)) |
| 2 | 14 | name `g_invNames + slot·0xe` — the scene object's name (for example `NOTES.BM`, or `GAZ_I.047`) with NUL |
| 16 | 0xdd4 | picture `g_invImages + slot·0xdd4`: `u16` width, `u16` height, RGB565 pixels (key 0 = transparent), at most 1768 pixels |

The name and the picture are the whole slot buffers. After the name's NUL and after the last pixel, **leftover bytes of earlier items** from that slot remain (up to 342 non-zero bytes in the data). The engine must copy them unchanged if it wants files identical to the original. The game does not use them.

The tail (23 B, no alignment):

| + | Type | Write | Read | Meaning |
|---|---|---|---|---|
| 0 | `i16` | `g_autoIncMin` `0x7cdee4` | the same | `AUTOINCRANGE`: value after wrap |
| 2 | `i16` | `g_autoIncMax` `0x51f84c` | the same | `AUTOINCRANGE`: upper bound |
| 4 | `i16` | `g_autoIncVar` `0x55b278` | the same | `AUTOINCRANGE`: variable index, −1 = off |
| 6 | `u8` | `g_sceneSaveable` (flag 0) or 0 (flag 1) | `g_restoreJackPose` `0x79dfc8` | 1 = scene start places Jack in the saved pose |
| 7 | `f32` | `g_jackSavedX` `0x8a8a78` | `g_jackLoadX` `0x51f850` | Jack's X |
| 11 | `f32` | `g_jackSavedY` `0x55160c` | `g_jackLoadY` `0x52ab4c` | Jack's Y (feet) |
| 15 | `f32` | `g_jackSavedScale` `0x5501b4` | `g_jackLoadScale` `0x7cda68` | perspective scale |
| 19 | `i16` | `g_jackSavedDir` `0x8f691a` | `g_jackLoadDir` `0x8f6918` | direction 0…4 (`g_jackDir`) |
| 21 | `i16` | `g_jackSavedFacing` `0x504784` | `g_jackLoadFacing` `0x504782` | 1 / −1 (`g_jackFacing`) |

Write and read use **different** variables. `g_jackSaved*` is a copy of Jack's pose, refreshed every frame while the player is not locked (`g_macroPlayerLocked == 0`, `Game_Run` `0042cbb8`), so a save during a cutscene remembers the pose from before it. `g_jackLoad*` is read on scene entry (`Game_Run` `0042c8b0`): when `g_restoreJackPose` and the scene has Jack control (`g_sceneNoControl == 0`), `g_jackX/Y/Dir/Scale/Facing` come from the file and `Jack_Stand` runs immediately (`00415960`, twice). Then the view (`Game_Run`): if X > 650 and the view is 0, `g_bgScrollStart = min(background width − 640, 0x178)`, rounded down to a multiple of 4 (the right edge). If **X < 650 and the view is not 0, the view becomes 0**. X = 650, or a view that is already right, is left alone. A scene whose start view sits on the right (SC006, from `.CCG`) is therefore scrolled back after a load when Jack stands on the left. Only then does `INIT` start, and `Script_ExecStep` `0041a330` **skips the commands that place or move Jack** while `g_restoreJackPose != 0` (`bVar9 = strcmp(macro, "INIT") != 0`; cases 1, 2, 6, 7, 0x14, 0x15, 0x16, 0x49, 0x76 are `SETPOSITION`, `INITFIRST`, `WALKTO`, `RUNINSERTION`, `PUNDERP`, `PUNDERE`, `WALKTODIR` — for JACK — plus `STAY` and `ROTATETO`). `PRE` runs in full (its `SETPOSITION` overwrites the pose from the file, because the restore happens later). The flag lasts until the scene changes (`GoToScene` clears it). Loaded Jack therefore **stands where he was saved**. The alley entrance (SC006 with `LAST = 8`, a walk to 548, 349, direction 3) does not replay. A save with no pose (byte 0 — a `tempjs` copy from `Menu_Save` `0040b330` when `g_jackPlaced == 0`) starts the scene from scratch and Jack walks out of the alley. Only `Jack_Stand`, `STAY` (`004146e0`), and a restored pose (`00415960`) set `g_jackPlaced` — **not** `SETPOSITION` and not a walk. A save during the entrance (Jack walking to `548, 349`) is a copy of the start of the scene. A save after he stops (`STAY LD`) is the current state. That is the "nondeterminism" a player sees.

## 3. Header and version

- `Save_WriteState` writes `"Jack Orlando - normal ver"` or `"Jack Orlando - light ver"` (`g_easyVersion`) into slot 0's buffer `0x8a8db0` (`g_guiStrings[9]`, 0x50 B — the slot description from the old slot window, [savegame.md](../engine/savegame.md)) and writes the whole buffer. The buffer is in BSS (zeroes from startup). `Game_Main` writes only an empty string there, and nothing puts a longer text there, so the bytes after the text are zeroes.
- `Save_CopyTemp` does `strcpy(0x8a8db0, "Jack Orlando")` — it overwrites only 13 bytes — and writes the buffer, which still holds the rest of the last `Save_WriteState` header (always `tempjs` on scene entry). Copies therefore have `Jack Orlando` followed by a NUL and the leftover `- normal ver` or `- light ver`, and then the bytes of `tempjs` from `0x50` **unchanged**, including pose byte 0.
- `Save_LoadState` checks **only byte 15** (`'n'` / `'l'` inside the version marker): the easy version requires `'l'`, the normal version forbids it. Otherwise it `fclose`s and returns with no message (and without `g_gameLoaded`). The rest of the header is not checked. Any file whose byte 15 is not `'l'` will load in the normal version, including `Jacksave.00a`, whose header is the main-menu caption. A missing file (`fopen` is NULL) returns silently. A truncated file: `fread` checks nothing, and previous values stay in the buffers (the game reports no error). `Save_WriteState` and `Save_CopyTemp` do not check `fopen`. A write into a directory without permission is `fwrite` on NULL — likely a crash. The save-error and load-error strings (`g_guiStrings[40]` and `[41]`) are only installed by `Game_Main`. Nothing reads them.

In the data, current saves have pose byte 1. `tempjs` and every copy have 0.

## 4. What a save holds, and what it does not

The file holds **only** the game variables (`VARIABLE.ALL`, [text.md](text.md)), the scene, the music track, the coat (slots, names, pictures), the `AUTOINCRANGE` state, and Jack's pose. Everything else follows from the variables or is rebuilt on scene entry. A load always ends in `g_sceneChange` and a full scene start (`PRE`, `INIT`). See [savegame.md](../engine/savegame.md).

| State | Where | After a load |
|---|---|---|
| scene | the scene field | entry into it (`g_sceneChange`) |
| `LAST` (where Jack came from) | variable 3 | `PRE` / `INIT` scripts, as on a normal entry |
| Jack's position, direction, scale | the tail | only when the pose byte is 1 and the scene has control; otherwise the scene script sets it |
| uniform | variable `JACKISWOJ` | `00409090`: no uniform and `JACKISWOJ == 1` → `Jack_LoadWalkFramesUniform`; in the uniform and `JACKISWOJ == 0` → `Jack_LoadWalkFrames` |
| weapon / cursor | variable `GUN` (`0x4f7268`) | `GUN ≠ 0` → `Cursor_LoadSet2`, otherwise `Cursor_LoadSet1` |
| coat | the items | `TopBar_Rebuild` plus pictures and shadows on the bar (`Item_BuildShadowImage`, `Blit_Keyed16`), `g_coatScrollRow = 0` |
| item in hand | **absent** | F2/F3 put it away before the save (`Item_PutBackToBar`). **F5 does not**, and a load clears the hand, so the item is lost (§5.1). |
| macros, areas, characters, animations, `INITFIRST` | **absent** | rebuilt on scene entry |
| `AUTOINCRANGE` | the tail | restored; it keeps counting (only the `Game_Run` prologue clears it). |
| easy version | header byte 15 | only a compatibility check; `Game_Run` sets `LIGHTVER` on every scene |

Data: 247 variables in every Director's Cut save (the count in `VARIABLE.ALL`). Values past `var_count` are zero. `AUTOINCRANGE` is `(0, 200, LOC7)` after the `SC000D` intro and `(0, 60, OCHR)` in the port (`SC077`).

The uniform has no field of its own, only `JACKISWOJ`. The `Game_Run` prologue (once per game) zeroes `g_jackUniform`, so a freshly started game that loads a save made in the uniform picks the uniform frames.

## 5. A save the original will accept

`writeSave` writes the fields in this order. `parseSave` then `writeSave` yields **the same file, byte for byte**, for all 33 files. The helpers reproduce what the game does:

- `currentHeader(light)` — the `Save_WriteState` header. `copyHeader(prev)` / `copyTemp(tempjs)` — the `Save_CopyTemp` copy.
- `savedMusic(name)` — replaces `TR02*` with `TR17-22.PMS`.
- `itemImage(w, h, rgb565)` — a 0xdd4-byte picture buffer (zeroes after the pixels; the original has leftovers there, which the game does not read, so the file still loads).
- `acceptedBy(save, light)` — the byte-15 test from `00409090`.

For the original to accept an engine file: 500 variable values (indexes as in `VARIABLE.ALL`), `var_count` equal to the count in `VARIABLE.ALL` (247 in Director's Cut — a smaller count hides the later variables, because `Var_Get` searches only up to `g_varCount`), coat slots with RGB565 pictures keyed on 0, pose byte 1 for a current save and 0 for `tempjs` and copies, and a header with the right byte 15.

### 5.1 The F5 bug: the item in hand is lost

F5 does not put the held item away (F2 and F3 do, through `Item_PutBackToBar`), so the file does not contain it, and a load (`Cursor_ResetMode` `00419740` clears the hand) removes it from the running game as well. Confirmed in the code and in play. An item required to finish the game can be lost this way. The engine departs from the original here: before F5 it calls the equivalent of `Item_PutBackToBar`, as F2 does (the item returns to the first free slot, the cursor goes to mode 0). The file stays in the original format and the original will load it. The only difference is that the item is in the coat.

A faithful F5, matching the original, would drop the held item. The engine does not do that.

## 6. `Jacksave.00a`

1135 bytes, no items. The header is the main-menu caption (Mazovia), byte 15 is 0, the music is `TR03-22.PMS`, the scene is `SC032.CCG`, the pose is `(0, −100)`, the scale is 0.1, the pose byte is 0, and `AUTOINCRANGE` is `(0, 200, LOC7)`. **`var_count` is 225**, while `VARIABLE.ALL` in Director's Cut has 247 variables. The first missing one is `LIGHTVER` (number 225), then among others `MARZECZY` (228) and `JACKISMENU` (246). The file is therefore from an older variable table (without `LIGHTVER`, `MARZECZY`, `JACKISMENU`, and others). The file format is the same. Loading it in Director's Cut (typing the name in the F3 window) would set `g_varCount = 225`, so `Var_Get` would not find the last 22 variables until `Var_LoadAll` (a new game) restores the count. The file is most likely a slot from the older slot window. See [savegame.md](../engine/savegame.md).

## Checks

`verifySave` checks a byte-for-byte round trip, the extension against byte 15, known headers, a copy header equal to the current header from byte 13, the pose byte (1 for current saves, 0 for `tempjs` and copies), music that is `.PMS` and not `TR02`, a `.CCG` scene, zeroes past `var_count`, slots in ascending order, pictures of at most 1768 pixels, and the tail ranges. Tests: `packages/engine/src/formats/save.test.ts`.

## Open

- `0x8f6890` — a loop `while (0 < *0x8f6890)` before every item (write and read) waits on a counter changed elsewhere (the same condition is in `Cursor_LoadSet1`). What it counts was not established.
- The condition `*0x6d38ca == 3` at the start of a scene turns on `AUTOINCRANGE OCHR 0 60` with no script. What that mode is was not established.
