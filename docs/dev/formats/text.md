# Text files in RESOURCE.PAK: VARIABLE.ALL, ELEM.LST / .GER, TEKST.COD

Four files from `Resource\RESOURCE.PAK`. Parser: `packages/engine/src/formats/text.ts` (`parseVariables`, `parseItems`, `lookupItem`, `parseCredits`, `SPECIAL_VARS`, `CREDIT_ROW_HEIGHT`).

| File | Size | Encryption | Who reads it | Role |
|---|---|---|---|---|
| `VARIABLE.ALL` | 3286 | plain | `Var_LoadAll` `0044a600` | game variables (name, initial value) |
| `ELEM.LST` | 2921 | plain | `Item_LookupName` `00429ce0` | item names shown on hover |
| `ELEM.GER` | 2921 | plain | **nobody** | byte-identical to `ELEM.LST` (German element list) |
| `TEKST.COD` | 4166 | `Text_Decrypt` | `Gui_ShowAbout` `0040af60` | lines of the about window (scrolled) |

Shared rules: [textcrypt.md](textcrypt.md) — the cipher, **Mazovia** (not cp1250), the tokenizer `Text_NextToken` `00405f00` (a token is bytes `> 0x20`; spaces, tabs, and CR/LF are equivalent separators), and `Text_ReadShort` `00406020` (`atoi`, result `int16`). Line endings are only `CR LF`. Every file ends with `CR LF`. The only other control character is `TAB`. Parsers check this.

`Movies\*.DLG` (movie captions) are **not** this family. They are pictures; [subtitles.md](subtitles.md) describes them. Scene dialogue `.DCN` is [dialog.md](dialog.md).

`Pak_ReadText` `004579f0` is **not** the game-text tokenizer. It reads characters from an archive file and is called only by `Pak_Scanf` `004571f0`. Every file below is read with `Text_NextToken` from a buffer loaded by `Res_Load`.

## VARIABLE.ALL — `Var_LoadAll` `0044a600`

```
NAME value
NAME value
…
```

Pairs of tokens (usually one per line), read in a loop `do … while (g_textPos < g_textLen)`: a name (`Text_NextToken` into `g_varNames + n·0x1e`) and a value (`Text_ReadShort` → `int16` in `g_varValues[n]`, `atoi`, so `40000` → `-25536` and `abc` → `0`). Order in the file is the **variable index** `n`. `g_varCount` grows by 1 per pair.

- A name is at most 29 bytes (a 30-byte slot with NUL; a longer name overflows the next name — the parser rejects it). The value table has room for 2024 entries (`008a27d8`…`008a37a8`). The parser rejects more.
- A missing value at the end of the file: `Text_ReadShort` does not write the destination, so old memory remains. The parser reports an error. It does not occur in the data.
- Names are uppercase and compared with `strcmp` (`Var_Set` `004065b0`, `Var_Get` `00406630`, `Script_ReadValueOrVar` `00440b70`). **Search is linear from the start. The first hit wins.** The data has no duplicates.
- After loading, if `DAT_00851d05 != 0`, `LAST` receives `DAT_008ab960`. The source of both values was not traced (a possible link with loading a save; see [save.md](save.md)).
- **Variables remembered by index** (a `strcmp` loop finds the index; the rest of the code reads `g_varValues[index]` without searching by name):

 | Name | Index in the file | Code variable | Meaning |
 |---|---|---|---|
 | `GUN` | 1 | `005046ec` | whether Jack has the gun (the verb menu shows the weapon verb when `== 1`) |
 | `LAST` | 3 | `005046ee` | number of the previous scene (initial value 5) |
 | `RAND` | 4 | `008f68f4` | result of `TALKRANDOM` |
 | `MOUSEX`, `MOUSEY` | 5, 6 | `006bb282`, `006d5f32` | click point (`Cursor_UpdateHotspot`) |
 | `JACKX`, `JACKY` | 7, 8 | `007c7a5c`, `007cdede` | Jack's position (`SETPOSITION JACK`) |
 | `MENU` | 9 | `007cde80` | |
 | `SHOOT`, `SLAP` | 10, 11 | `008a1782`, `00723d9e` | |
 | `SHIFTX` | — (not in the file) | `005046f0` | recognized, but the file has no such name — unused variables |

  Before loading, the indexes of `MOUSEX`/`MOUSEY` and `JACKX`/`JACKY` are set to `499` (outside the file's table). `XXX` (index 0) and `ISSOUND` (2) have no code variable. `Game_Run` sets `LANVER`, `ISSOUND`, `LIGHTVER`, and `JACKISMENU` by name (`Var_Set`) ([scripts.md](../engine/scripts.md)).
- The file has 247 variables. Initial values: 234 × `0`, 12 × `1`, `LAST` = `5`. Names usually encode a scene number. They are plot and inventory flags. The first variable is `XXX`, the last is `JACKISMENU`. The `SLAP` row has two spaces, which does not matter.

Scripts use the variables through `SETVAR` and the rest, and through `*NAME` in `Script_ReadValueOrVar` ([scripts.md](../engine/scripts.md)). A save stores `g_varValues` ([save.md](save.md)).

## ELEM.LST — `Item_LookupName` `00429ce0`

```
<number> <ITEM_NAME> <FILE>
```

Records of **three tokens** (columns separated by any whitespace — the file uses tabs and spaces):

1. A number, read into `DAT_0051f738` and **never used** in the search. In the data: the numbers `1`…`98` (95 records; 22, 94, and 95 are missing in that range) or `&` (9 records). Hypothesis: `&` marks an item with no number of its own (for example the same key in several versions).
2. A name, in Mazovia, with spaces stored as `_`. The function turns `_` back into spaces (`FUN_0047d4e0`) and copies the result into the caller's buffer.
3. A file — the item picture name (`KLUCZYK.BM`, `KEY2.011`, `LOM_I.057`; the extension is sometimes a scene number). This is the **search key**: the first record whose third token equals the given name (`strcmp`, **case-sensitive**). A miss writes three question marks into the result buffer (`004f7ec8`, `strcpy` in `00429ce0`).

Call sites: `Game_Run` (`0042b6d0`) in two places in the **coat** screen loop (items sit in the coat grid, slots `0x30 × 0x34` px from `(0x6e, 200)`; this is not the top bar): (1) when the pointer is over an occupied cell (`g_itemInHand == 0`, cell index `DAT_008a7c34`, occupancy table `0051fa08`) and (2) when an item is chosen from `DAT_0088f318`. The key is the picture name stored in a 14-byte slot (`DAT_007bf0d8 + n·0xe`; `strcpy` when an item enters the coat, in `Inventory_Add` `004197a0`, from the scene object's name). The result goes to `FUN_00429dd0` (`Notice_Show`): it creates a text sprite (`Sprite_Add`, `Text_PrintfAt…`, `z = 0x640`, height 15 px) and sets flag `00563f20` — the message bar, not the inventory. The searched buffer is `0x8a2bf0`, loaded by `Game_Main` (`0044d7a4`, `Res_Load`). The length comes from `Pak_FileSize` on every call. The bar sits at the bottom of the screen. The sprite coordinates inside `00429dd0` were not traced.

- The file ends at `g_textLen`. A partial record at the end does not occur (the parser reports an error).
- 104 records. Every file named in the third column exists in the game archives. There are no repeated keys, so "first wins" does not matter in the data. File names are at most 13 characters.
- `ELEM.GER` is identical and unread. Another language would need the code to choose a file.

## TEKST.COD — `Gui_ShowAbout` `0040af60`

Encrypted ([textcrypt.md](textcrypt.md)). After decryption, 280 lines (CR LF), each:

```
<kind><style><text>
```

`FUN_0040a7e0` `0040a7e0` reads the lines like `Text_NextToken`, but **splits on bytes < 0x0e** (spaces stay in the text; empty lines are skipped). `FUN_0040a900` (`Credits_DrawLine`) draws a line:

| Kind (1st character) | Row height | Use |
|---|---|---|
| `=` | 13 px | name lines (and a spacer when the text is empty) |
| `#` | 9 px | section headers (and a spacer) |

Style (2nd character): `1` → color `DAT_00504aba`, anything else (`2`, `!`) → `DAT_00504ab6`. `!` also sets the scroll-pause counter `DAT_008f6934 = 300` (`Credits_ScrollTick` `0040aa50` counts it down each tick, and at zero scrolls the buffer and eventually pulls the next line). Text starts at the 3rd character and goes to `Text_PrintfWidth` / `Text_PrintfAt`. After the end of the text (`g_textPos >= g_textLen`) the lines start over.

Kind and style in the data: `=2` 144 (names), `#1` 99 (headers and gaps), `=1` 27 (gaps in the list), `#!` 9 (headers with a pause), `#2` 1. Every line has at least 2 characters. The text is credits and thanks, in Mazovia (byte `0x82` is `é`). The about window is `0x1cc × 0x154`, button `AboutOk`. The note does not reproduce the lines.

## For the engine

`parseVariables` is the initial variable state (`name → value`, index = position). `parseItems` plus `lookupItem(items, bitmapFile)` is the coat caption on hover. `parseCredits` is the about window.

## Checks

`verify` requires CR LF and no stray control characters. `VARIABLE.ALL`: no duplicates, and every special variable except `SHIFTX`. `ELEM`: a numeric id or `&`, a file name of at most 13 characters, no duplicate keys. `TEKST.COD`: kind `=` or `#`, style `1`, `2`, or `!`.

## Open

- What `&` means in `ELEM.LST`, and the role of `XXX` (index 0).
- The exact look of the about list (colors `00504aba` / `00504ab6`, font height). The code draws through `Text_PrintfAt`. The window itself is in [gui.md](../engine/gui.md).
