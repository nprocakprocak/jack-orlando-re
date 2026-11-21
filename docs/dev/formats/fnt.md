# .FNT format — bitmap fonts

A font is a table of 256 glyph descriptions (one per text byte) plus glyph pixels, 8 bits per pixel. Parser: `packages/engine/src/formats/fnt.ts` (`parseFnt`, `verifyFnt`, `layoutText`, `textWidth`, `renderText`). The layout matches the tables read by the draw functions `0046e580` and `0046e6b0`. Confirmed on both font files.

The engine reads `JACK.FNT` and `JACKM.FNT` from `Resource/RESOURCE.PAK`. The original game does not: the executable has no string `FNT` and no `JACK.F…`, and the fonts it draws live in `.data` (see [Fonts in the executable](#fonts-in-the-executable)). The PAK files are an older revision of the same format. This repository does not ship either copy.

| File | Size | Glyph height | Engine use |
|---|---|---|---|
| `JACK.FNT` | 24558 B | up to 19 (plus an 84×28 logo in code 255) | large font: dialogs, in-game menu, start screen, main menu, credit lines of kind `=` |
| `JACKM.FNT` | 14096 B | up to 12 | small font: in-game menu, coat and item names, credit lines of kind `#` |

## File layout

Little-endian.

```c
struct GlyphEntry { // offset 0, 256 entries of 4 bytes; entry i describes text byte i
  uint16_t offset; // from the start of the file to the glyph pixels
  uint8_t width;
  uint8_t height;
}; // the table is 0x400 bytes; glyph data starts at 0x400

uint8_t pixels[]; // glyph: width*height bytes, rows from the top; 0 / 1 / 2
```

- **Pixels:** `0` is transparent, `1` is the outline color, any other non-zero value is the fill (the files only use `2`). `0046e580` draws it that way: `cVar2 == 1` → outline parameter, otherwise the fill parameter, `0` skips the pixel. Colors are **arguments of the draw function** (RGB565). The font has no palette.
- **No vertical offsets.** Every glyph is drawn from the same row `y` (the top edge). Baseline alignment is built into the bitmaps (empty rows at the top).
- **Shared pixels.** Codes with no character point at one shared glyph. In the PAK files that glyph is blank (`JACK` 6×1, `JACKM` 5×1). ASCII space (`0x20`) is a separate blank and is the same bitmap in the PAK files and in the executable. `/` is not drawn: it is the spacing control. The file has no gaps: glyph data ends exactly at the end of the file (`verifyFnt` checks this).
- There is no header, signature, or count. The file size follows from the table (`max(offset + width*height)`).
- Draw width is `width & 0x7f` (the loop in `0046e580`). Every glyph is ≤ 86, so the mask does not matter. `verifyFnt` reports a width above 127.

## Character map

The index is the text byte. Codes `0x20`–`0x7e` are ASCII (missing, among others, `/ < > ^ { | } ~`, and in the PAK files also `]`). Bytes `0x80`–`0xFF` are **Mazovia**: glyphs exist for all 18 Polish letters (bytes `0x86 0x8D 0x8F 0x90 0x91 0x92 0x95 0x98 0x9C 0x9E 0xA0`–`0xA7`) and for the German-edition letters (`0x81 0x84 0x94 0x8E 0x99 0x9A 0xE1`), plus `0xE2` and `0xFB`. `é` (`0x82`) is a real glyph only in the executable copies; in the PAK files it is the blank default, same as `]` (`0x5D`). Control codes that have glyphs: `0x04`, `0x07`, `0x10`, `0x11`, `0x18`–`0x1B` (diamond, dot, arrows, as in CP437). Code `0xFF` in `JACK` is an **84×28 logo** (86×28 in the executable). In `JACKM` it is the blank default.

Nothing passes byte `0xFF` to the font. Dialogue (`.DCN`), item names (`ELEM.LST` / `ELEM.GER`), menu captions, and the main-menu title do not contain it. The picture on the main menu is `JACBM.BM`, not this glyph. The PAK logo can stand in for the executable logo because it is never drawn.

`é` does occur, in four big-font credit lines of `TEKST.COD` (kind `=`, one byte each). Those lines are drawn with `JACK.FNT`. `encodeMazovia` writes `é` as `e` (`0x65`), and the coat's `encodeText` uses that same function, so the letter is drawn instead of a blank gap. Lipsync counts those same bytes, so the mouth follows the drawn letter. Decoding still yields `é`. No dialogue line, item name, or menu caption uses `é` or `]`. The main-menu title's diamond (`0x04`) is drawn with `JACK`, and that glyph matches the executable copy. On `JACKM` a few glyphs differ by one to three pixels or by a row (`0x04`, `0x07`, `0x10`, `0x11`, `0x2B`, `0x69`, `0x84`); the letter `i` is the one of those that captions actually use, and both files still draw it.

## Text layout

`Font_TextWidth` `0046e6b0` and `Font_DrawText` `0046e580`:

- Character `c` is drawn at the current `x`, then `x += width(c) + spacing`. Default spacing is **1 px**.
- The byte `/` (`0x2f`) is a **control sequence**: the next byte `d` sets spacing to `(d - '0') & 0xFF` (digits `/0`…`/9`; any other byte also "works"). Neither byte is drawn. `/` therefore has no glyph and cannot be printed. A string that ends on `/` reads past the terminator (an original bug). The parser stops the text there.
- End of text: byte `0`. The font does not wrap lines. Higher-level functions split on `|` (for example `004649f0`).
- Line height is not fixed. Each glyph has its own. `renderText` uses the tallest glyph that was drawn.

| Address | Name | What it does |
|---|---|---|
| `0046e580` | `Font_DrawText` | draws a string in RGB565 (`param_1,2` x,y; `param_3` outline; `param_4` fill; `param_5` buffer pitch; `param_6` font; `param_7` text; `param_8` buffer) |
| `0046e6b0` | `Font_TextWidth` | width of a string (`param_1` font, `param_2` text) |
| `0046e740`, `0046e8f0` | `Font_DrawTextRemap(Alt)` | variants in which a glyph pixel transforms the destination pixel through color tables (`+0x1080`, `+0x2100`, channels 5/6/5) instead of writing a constant color. Likely translucent or shaded text. Where the table comes from was not checked |
| `0047b1c0`, `0047b8e0`, `0047bfd0`, `0047c6c0` | `Debug_PrintAt`, `Text_PrintfAt*` | printf-style wrappers (`%c %d %f %s`) that call the functions above |
| `0047cdb0` | `Text_PrintfWidth` | the same formatting, returns the width |

Every function picks the font the same way: `param_6 == 0` → `0050df68`, otherwise `00514110`.

## Fonts in the executable

Two tables in `.data` have exactly this layout (description table plus pixels):

| Font | VA | File offset | Size |
|---|---|---|---|
| large (`JACK`) | `0x50df68` | `0x10df68` | 24994 B |
| small (`JACKM`) | `0x514110` | `0x114110` | 14324 B |

The first buffer is 0x61a8 bytes (the distance between the tables). The engine does not use these tables. They differ from the PAK files:

- `JACK`: added `é` (`0x82`) and `]` (`0x5d`); the `0xFF` logo is 86×28 instead of 84×28.
- `JACKM`: added `é` and `]`. Codes with no character point at a 6×1 glyph that is not all zeros; in the PAK they point at a blank 5×1. ASCII space is unchanged. Glyph bitmaps `0x04 0x07 0x10 0x11 0x2B 0x69 0x84` differ (one to three pixels, or one row on the two arrows).

Text is Mazovia bytes (see [textcrypt.md](textcrypt.md)).

## Open

- Who calls `0046e740` / `0046e8f0`, and where the color tables come from, was not studied.
- Where (if anywhere) the `0xFF` logo is drawn was not found.
