# Dialogue `.DCN` and faces `.FCC`

Scene files `SCxxx.DCN` (lines and answer menus) and `SCxxx.FCC` (speaker faces). Both live in `Action\SCxxx.PHK`, are encrypted ([textcrypt.md](textcrypt.md), `Text_Decrypt`), and are read by the tokenizer `Text_NextToken` ([global.md](global.md), `packages/engine/src/formats/global.ts`). Parser: `packages/engine/src/formats/dialog.ts` (`parseDcn`, `parseFcc`, `findTalkLine`, `findDialog`, `voiceName`, `parseSceneDialogs`).

`.DCN` exists in 132 scenes, `.FCC` in 62. `SC000D`, `SC005`, and `SC022` have no `.DCN`. The loader checks `Pak_Exists`; a missing file means no lines.

`.DCG` (a copy of `.DCN` that nothing loads) is in [textcrypt.md](textcrypt.md). `.FCM` is **not** a face list. It is the short films of `RUNFILM` ([global.md](global.md)). `.FCC` and `.FCM` share nothing but a similar extension.

## `.DCN` — `Scene_LoadDcn` `00440520`

A stream of tokens separated by whitespace (bytes ≤ `0x20`). Spaces inside text are stored as `_`. The loader turns them back (`FUN_0047d4e0(text, '_')`). Text is Mazovia. Other characters (for example `=` before `?` / `!`) go into the game unchanged.

Two record kinds, told apart by the **first character** of the first token:

```
<id> <text> <width> <sound> ; one line
Q <id> <n> (<text> <width> <sound>) × n ; block: answer menu
R <id> <n> (<text> <width> <sound>) × n ; block: random group of lines
```

- The loader treats `Q` and `R` the same (the code is duplicated). The difference is which script command uses them (below). In the data: 586 `Q` blocks, 332 `R` blocks, 7746 entries in all (the most is `SC054`, 491).
- A single line's `<id>` is `atoi` of a token read into an 8-byte buffer. A longer token overflows the stack; the parser rejects it. Option *i* of a block has id = `block id + i` (int16, wrapping: `R 40000` has id `-25536`; block ids above 32767 do occur).
- `<width>` (`short`) is **not a duration**. It is the caption window width in pixels. `FUN_0040d250(x, y, width, text)` (`0040d250`) wraps the text to that width and centers it on `x`. Values in the data are 115–415. Display time is computed by `ExecStep`: `3·length + 200` ([scripts.md](../engine/scripts.md)).
- `<sound>` is a name such as `T002.SND`. The game plays **`T002.S22`** from `SCxxx.PHK` (`Sound_PlayTalk` `00407750` replaces the extension; `voiceName()`). When the `.S22` is missing the function returns 0 and the line is captions only (`FUN_00406750` instead of `FUN_00406810`). Three of 7746 entries have no voice (`SC107` id 873, `SC112` id 11100 — its `T384.SND` belongs to a different line — and `SC117` id 365).
- A single line longer than `0x103` characters is truncated. A block option has no check, and a longer text would overwrite neighboring fields. The longest text in the data is 104 characters. The parser truncates a line and rejects an over-long option.
- A first token that is also the **last** token of the file is ignored (the loader returns when `g_textLen <= g_textPos`). A record broken in the middle leaves the previous scene's bytes in the table. The parsers report that (`DialogError`). It does not occur in the data.
- There is no capacity check on the tables (`0x6e3568` and the rest). A scene has up to 491 entries.

### Tables after loading

One entry table (lines and options together, in file order) and three parallel dialogue tables:

| Address | Contents |
|---|---|
| `0x6e3568` | entries of `0x118` B: text `+0` (`0x104`), sound `+0x104`, width `+0x112`, id `+0x114`, hidden flag `+0x116` (cleared on load; set by `SETDIALOG`) |
| `0x6bd1f8` | entry count |
| `0x871668` / `0x51fa60` / `0x553200` | dialogue: id (int32) / option count / index of the first option in the entries |
| `0x6d5058` | dialogue count |

Both searches return the **first** hit, or `-0x10000` when missing:

- `Script_FindTalkLine` `0040d9b0` — by id among **all** entries (lines and options). Used by `TALK`. In TS: `findTalkLine`.
- `Script_FindDialog` `0040da40` — by block id. Used by `DIALOG`, `IFANSWER`, `SETDIALOG`, `TALKRANDOM`, `TALKRANDOMINDEX`. In TS: `findDialog`.

Entry ids inside a scene almost never repeat. The only exception is `SC047A`: block `Q 9000` (options 9000, 9001, 9002) and block `Q 9002` (9002, 9003) share id 9002. That does not break anything. `DIALOG` / `IFANSWER` find a block by the block id, and playing the chosen option goes through `first + index`, not through the entry id. No macro uses `TALK 9002`. Option 0 of dialog 9002 (the block shown after money is handed over, macro `GAD_LASP_A`) is one of two options drawn together as the menu at the bottom of the screen. `Talk RIGHT 964` is a different line.

### How a dialogue ties to the script

Command details: [scripts.md](../engine/scripts.md). What `Script_ExecStep` `0041a330` and `Game_Run` `0042b6d0` do:

- `DIALOG speaker dialog` (`case 0xb`): count options whose hidden flag is `== 0`, `y = 0x1d3 − 25·count`, call `FUN_0040bf90(x=6, y, first, count, colors…)`, turn the cursor on, remember the dialogue (`0x563f28`) and the speaker (`0x79e160`: `"LEFT"` or anything else), and stop the macro (`0x6c26b8[i] = 0`). The macro waits for an answer.
- `FUN_0040bf90` builds a list of up to 8 options: it skips hidden ones, sets each option's width to the text width `+4` rounded up to even, and **sorts options by that width, ascending** (bubble sort, stable), with hidden ones (`10000`) at the end. Row *k* is at `y + 0x18·k`. The answer is the **original option index in the block** (0…n−1), not the position after sorting. A click is recognized by `FUN_0040c550`.
- `Game_Run` (the block around `DAT_00851d02`) stores the choice in `g_dialogAnswers[dialog]` (`0x6dac80`; `IFANSWER dialog n` compares with `n`), then plays the chosen option: `Sound_PlayTalk` on channel 1 for `LEFT`, otherwise 2, the caption through `FUN_0040d250(x, 0x8c, option width, text)`, and the face and end of the line as in `TALK`.
- `TALK speaker line channel ±`: `Script_FindTalkLine`, then text, sound, and width from the entry.
- `TALKRANDOM speaker dialog channel ±` (`case 0x20`): a random index `0…n−1` in the block, stored in the variable `RAND`. `TALKRANDOMINDEX` takes the index directly. `R` blocks are for this; `Q` blocks are for `DIALOG`. That is a convention of the data. The loader does not distinguish them.
- `SETDIALOG dialog option state` (`case 0x39`): `hidden = (state == 0)` on the entry `first + option`.
- Caption color is the speaker color from table `0x8f68a4` (index = face slot; slots below 2 use the default color).

## `.FCC` — `Scene_LoadFcc` `00440010`

A list of faces for the talk windows (132×132 px: `0x84`; the left window at `scrollX + 2`, the right at `scrollX + 0x1fa`). Each face is 12 tokens:

```
[NAME] ; Str_StripEnds: drops the first and last character, without checking them
FACE.PBM ; face (no mouth, no eyes)
ex ey ; eye position in the window
OCxx1.PBM OCxx2.PBM OCxx3.PBM ; 3 blink frames (Str_Upper)
mx my ; mouth position
USxx1.PBM … USxx5.PBM ; 5 mouth frames (case left as stored)
```

- The name is up to 19 characters (`0x14` B per face, `0x752a08`). `SHOWFACE` finds it with `strcmp` (case-sensitive), `Script_FindFace` `0040dad0`, first hit.
- **The face index in the game is the file position + 2** (`g_faceCount` `0x7bf078` starts at 2; slots 0 and 1 do not come from `.FCC`). Slots 0 and 1 are Jack's faces from `RESOURCE.PAK`, set in `Game_Main` `0044d1d0` (positions written in the code): `JACK` = `FACEJ.PBM`, eyes `OCJA1`–`3` at `(0x22, 0x30)`, mouth `USJA1`–`5` at `(0x23, 0x48)`; `JACKWOJ` = `FACEJAW.PBM`, `OJAW1`–`3` at `(0x25, 0x2d)`, `UJAW1`–`5` at `(0x23, 0x47)`. `Script_FindFace` searches from slot 0, so `SHOWFACE JACK` finds slot 0 (no `.FCC` has a face named `JACK`; `SC115` has `JACKTEL`). When Jack wears the uniform (`g_jackUniform` — the flag is the uniform despite the name; variable `JACKISWOJ`, `EXTRA 6`, `00417e40`), `SHOWFACE JACK` shows `JACKWOJ`, always without the mirror star (`Script_ExecStep` case `0x17`). Previous faces are freed on every file load, including when the scene has no `.FCC`.
- Each file is read from `g_pakAction` (the scene PHK). A missing file is size 0, and that is not checked. In the data all 124 faces have a complete set of files.
- Composing the window (details and buffer state: [the face window](../engine/dialog.md#face-window)): the face is drawn at `(0x82 − width, 0x82 − height)` in a 132×132 buffer, which in the data is always `(2, 2)` (all 124 faces are 128×128). Eye and mouth overlays: top-left at `(x + 2, y + 2)`. In a mirrored window the frame is mirrored and `x` is measured from the right: `0x82 − width − x` (`Face_Show` `00413970`, `Talk_FaceStep` `00413e20`, blinking in `Game_Run`). Width and height of every frame in a set are taken from the header of **frame 0**. In the data the frames of a set share a size, no overlay sticks out of 128×128, and eyes and mouth do not overlap. The left window is mirrored unless `SHOWFACE` was given a star (`L*`, `g_faceLeftStar` `0x722f00`). The right window never is. In the scripts: 1205× `L`, 947× `R`, 2× `L*` (`PULKSL`, `SEKRSL`). A face in the left window is almost always a mirror of the drawing.
- Eye and mouth frame size comes from the `.PBM` header ([pbm.md](pbm.md)). `x` and `y` are the top-left relative to the inside of the window (the 2 px frame excluded).

## Notes for the engine

- **`=` before `?` / `!`** (2168 of 2310 `=` characters; the rest are `=-`, `=O`, `=p`, and similar) is a narrow space. Glyph `0x3D` in fonts `JACK` and `JACKM` is 3×1 and all zeros, so on screen the mark is not visible and the punctuation sits a few pixels away. The engine draws the bytes with the font and does not substitute characters.
- Voices: `T###.SND` → `T###.S22` in the scene PHK ([sound.md](sound.md)). Scene archives contain no `.SND` files.
- Caption position, wrapping (`FUN_0040d250`), and option order (sort by width) are in [dialog.md](../engine/dialog.md).

## Checks

Every scene `.DCN` and `.FCC` parses. Blocks have 1–8 options (1–5 in the data). Block ids are unique. Entry ids are unique except `SC047A` / 9002. Every face file is in the PHK. Tests: `packages/engine/src/formats/dialog.test.ts`.
